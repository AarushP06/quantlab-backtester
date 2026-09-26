"""Build a five-year daily-price universe and show data-quality findings."""

from __future__ import annotations

import sys
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
    for symbol in SYMBOLS:
        observed = closes[symbol].dropna().index
        missing = sessions.difference(observed)
        if len(missing):
            incomplete[symbol] = len(missing)

    print(f"Symbols: {len(SYMBOLS)}")
    print(f"Date range: {prices.index.min().date()} to {prices.index.max().date()}")
    print(f"Total rows: {len(prices)}")
    if incomplete:
        print("Symbols with incomplete history (missing XNYS sessions):")
        for symbol, count in incomplete.items():
            print(f"  {symbol}: {count}")
    else:
        print("Symbols with incomplete history: none")

    output.parent.mkdir(parents=True, exist_ok=True)
    prices.to_parquet(output)
    print(f"Saved unchanged data to {output}")
    return prices


def main() -> None:
    # Today's session may still be in progress, so the end date is exclusive.
    end = pd.Timestamp.today().normalize()
    start = end - pd.DateOffset(years=5)
    build_dataset(start.date().isoformat(), end.date().isoformat())


if __name__ == "__main__":
    main()
