"""Download additional market-explorer stocks without changing the backtest universe."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quantlab.data import fetch, validate
from scripts.precompute_market import DATASET, EXTRAS

SYMBOLS = ["AMD", "ADBE", "CRM", "NFLX", "ORCL", "BAC", "KO", "PEP", "DIS", "MCD"]


def build_market_extras(
    symbols: list[str] = SYMBOLS, dataset: Path = DATASET, output: Path = EXTRAS
) -> pd.DataFrame:
    """Save adjusted daily history through the backtest snapshot's last date."""
    if not dataset.is_file():
        raise FileNotFoundError(f"Backtest dataset not found: {dataset}")
    universe = pd.read_parquet(dataset)
    existing = set(universe.columns.get_level_values("symbol"))
    overlap = existing.intersection(symbols)
    if overlap:
        raise ValueError(f"Already in backtest universe: {', '.join(sorted(overlap))}")
    start = universe.index.min().strftime("%Y-%m-%d")
    end = (universe.index.max() + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    prices = fetch(symbols, start=start, end=end)
    issues = validate(prices)
    print("Validation issues:")
    print("None" if issues.empty else issues.to_string(index=False))
    print(f"Symbols: {len(symbols)}")
    print(f"Date range: {prices.index.min().date()} to {prices.index.max().date()}")
    print(f"Total rows: {len(prices)}")
    print("First available date by symbol:")
    for symbol in symbols:
        print(f"  {symbol}: {prices['close'][symbol].dropna().index.min().date()}")
    output.parent.mkdir(parents=True, exist_ok=True)
    prices.to_parquet(output)
    print(f"Saved unchanged data to {output}")
    return prices


if __name__ == "__main__":
    build_market_extras()
