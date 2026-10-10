"""Refresh and validate all stock snapshots and static exports together.

Run from the repository root. The default end date is yesterday, so an
unfinished trading day cannot become the saved historical close.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import pandas_market_calendars as mcal

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quantlab.data import fetch, validate
from scripts.build_dataset import SYMBOLS as BACKTEST_SYMBOLS
from scripts.build_market_extras import SYMBOLS as EXTRA_SYMBOLS
from scripts.precompute_market import build_market_data
from scripts.precompute_results import build_results

# NYSE and Nasdaq closed for President Carter's National Day of Mourning;
# the installed exchange calendar still lists this as a trading session.
# https://www.nyse.com/publicdocs/nyse/markets/american-options/rule-interpretations/2025/National_Day_of_Mourning_20250102.pdf
EXTRA_CLOSURES = pd.DatetimeIndex(["2025-01-09"])


def quality_flags(prices: pd.DataFrame) -> set[tuple[str, str, str]]:
    """Return quality flags, excluding the documented 2025 exchange closure."""
    issues = validate(prices)
    if issues.empty:
        return set()
    issues = issues.loc[~((issues["issue"] == "missing bar") &
                          issues["date"].isin(EXTRA_CLOSURES))]
    return {(day.date().isoformat(), symbol, issue)
            for day, symbol, issue in issues.itertuples(index=False, name=None)}


def validate_snapshot(prices: pd.DataFrame, symbols: list[str], end: date,
                      allow_flags: bool = False,
                      known_flags: set[tuple[str, str, str]] | None = None) -> str:
    """Require a complete last session and report every flagged quality issue."""
    if prices.empty or not prices.index.is_monotonic_increasing or prices.index.has_duplicates:
        raise ValueError("Prices need unique, increasing trading dates")
    expected_symbols = set(symbols)
    if set(prices["close"].columns) != expected_symbols:
        raise ValueError("Downloaded symbols do not match the configured market list")
    sessions = mcal.get_calendar("XNYS").schedule(
        start_date=prices.index.min(), end_date=end
    ).index.difference(EXTRA_CLOSURES)
    if sessions.empty:
        raise ValueError("No completed market session in the requested period")
    latest = sessions[-1]
    if prices.index.max() != latest:
        raise ValueError(f"Latest market bar is {prices.index.max().date()}; expected {latest.date()}")
    missing = {}
    for symbol in symbols:
        observed = prices["close"][symbol].dropna().index
        if observed.empty or observed[-1] != latest:
            raise ValueError(f"{symbol} has no adjusted close for {latest.date()}")
        gaps = sessions[sessions >= observed[0]].difference(observed)
        if len(gaps):
            missing[symbol] = [day.date().isoformat() for day in gaps[:3]]
    if missing:
        raise ValueError(f"Missing stock sessions after listing: {missing}")
    flags = quality_flags(prices)
    new_flags = flags - (known_flags or set())
    if new_flags:
        print("New validation flags:", flush=True)
        for day, symbol, issue in sorted(new_flags):
            print(f"  {day} {symbol}: {issue}", flush=True)
        if not allow_flags:
            raise ValueError("Review new validation flags, then rerun with --allow-flags if accepted")
    print(f"Validated {len(symbols)} stocks through {latest.date()}; "
          f"{len(flags) - len(new_flags)} known flags, {len(new_flags)} new flags", flush=True)
    return latest.date().isoformat()


def refresh_snapshot(start: date, end: date, root: Path = Path("."),
                     allow_flags: bool = False) -> str:
    """Download, validate, build into a staging directory, then publish."""
    if start > end:
        raise ValueError("start must be on or before end")
    root = Path(root)
    symbols = BACKTEST_SYMBOLS + EXTRA_SYMBOLS
    if len(set(symbols)) != len(symbols):
        raise ValueError("Backtest and extra market lists overlap")
    known_flags = set()
    previous_universe = root / "data/processed/universe.parquet"
    previous_extras = root / "data/processed/market_extras.parquet"
    if previous_universe.is_file() and previous_extras.is_file():
        previous = pd.concat([pd.read_parquet(previous_universe),
                              pd.read_parquet(previous_extras)], axis=1).sort_index(axis=1)
        known_flags = quality_flags(previous)
    prices = fetch(symbols, start.isoformat(), (end + timedelta(days=1)).isoformat(), refresh=True)
    as_of = validate_snapshot(prices, symbols, end, allow_flags, known_flags)
    universe = prices.loc[:, prices.columns.get_level_values("symbol").isin(BACKTEST_SYMBOLS)]
    extras = prices.loc[:, prices.columns.get_level_values("symbol").isin(EXTRA_SYMBOLS)]
    with tempfile.TemporaryDirectory(prefix=".quantlab-refresh-", dir=root) as temporary:
        stage = Path(temporary)
        processed = stage / "data/processed"
        processed.mkdir(parents=True)
        universe.to_parquet(processed / "universe.parquet")
        extras.to_parquet(processed / "market_extras.parquet")
        static_data = stage / "static/data"
        build_results(universe, static_data)
        market = build_market_data(
            prices, static_data / "market.json",
            source="data/processed/universe.parquet + data/processed/market_extras.parquet",
        )
        if market["as_of"] != as_of:
            raise ValueError("Market export date differs from validated snapshot")
        for source in sorted(stage.rglob("*")):
            if not source.is_file():
                continue
            destination = root / source.relative_to(stage)
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.replace(source, destination)
    return as_of


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=date.fromisoformat, default=date(2005, 1, 1))
    parser.add_argument("--end", type=date.fromisoformat,
                        default=datetime.now(ZoneInfo("America/Toronto")).date() - timedelta(days=1),
                        help="last completed date to request (default: yesterday)")
    parser.add_argument("--allow-flags", action="store_true",
                        help="publish after reviewing flagged large moves")
    args = parser.parse_args()
    as_of = refresh_snapshot(args.start, args.end, allow_flags=args.allow_flags)
    print(f"Published validated backtest and market snapshots through {as_of}")


if __name__ == "__main__":
    main()
