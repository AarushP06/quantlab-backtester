"""Build a daily-price universe from 2005 onward and show data-quality findings."""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import pandas_market_calendars as mcal

# Allow `python scripts/build_dataset.py` from the repository root.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quantlab.data import fetch, validate

SYMBOLS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "BRK-B", "AVGO",
    "TSLA", "JPM", "WMT", "V", "MA", "XOM", "UNH", "COST", "PG",
    "HD", "JNJ", "ABBV",
]
OUTPUT = Path("data/processed/universe.parquet")


def build_dataset(start: str, end: str, output: Path = OUTPUT) -> pd.DataFrame:
    """Download [start, end), print findings, and save unmodified prices."""
    prices = fetch(SYMBOLS, start=start, end=end, refresh=True)
    issues = validate(prices)

    print("Validation issues:")
    if issues.empty:
        print("None")
    else:
        print(issues.to_string(index=False))

    sessions = mcal.get_calendar("XNYS").schedule(
        start_date=start, end_date=pd.Timestamp(end) - pd.Timedelta(days=1)
    ).index
    closes = prices["close"]
    incomplete = {}
    first_dates = {}
    for symbol in SYMBOLS:
        observed = closes[symbol].dropna().index
        first_dates[symbol] = observed.min()
        # Pre-listing NaNs are expected; report gaps only after the first bar.
        missing = sessions[sessions >= observed.min()].difference(observed)
        if len(missing):
            incomplete[symbol] = len(missing)

    print(f"Symbols: {len(SYMBOLS)}")
    print(f"Date range: {prices.index.min().date()} to {prices.index.max().date()}")
    print(f"Total rows: {len(prices)}")
    print("First available date by symbol:")
    for symbol, first in first_dates.items():
        print(f"  {symbol}: {first.date()}")
    if incomplete:
        print("Symbols with incomplete history after first listing (missing XNYS sessions):")
        for symbol, count in incomplete.items():
            print(f"  {symbol}: {count}")
    else:
        print("Symbols with incomplete history: none")

    output.parent.mkdir(parents=True, exist_ok=True)
    prices.to_parquet(output)
    print(f"Saved unchanged data to {output}")
    return prices


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=date.fromisoformat, default=date(2005, 1, 1))
    parser.add_argument("--end", type=date.fromisoformat,
                        default=pd.Timestamp.now(tz="America/Toronto").date(),
                        help="last date to include (default: today)")
    args = parser.parse_args(argv)
    if args.start > args.end:
        parser.error("--start must be on or before --end")
    # yfinance's end date is exclusive; the CLI's end date is inclusive.
    build_dataset(args.start.isoformat(), (args.end + timedelta(days=1)).isoformat())


if __name__ == "__main__":
    main()
