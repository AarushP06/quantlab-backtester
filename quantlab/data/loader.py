"""Data layer — build this first; it decides whether the rest is worth anything.

Rules that save weeks of confusion:
  1. Fetch once, cache to disk, never hit the network during a backtest.
  2. Validate on ingest, not when a result looks weird three weeks later.
  3. Use ADJUSTED closes, or splits look like -50% crashes.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

CACHE = Path("data/cache")


def fetch(symbols: list[str], start: str, end: str, refresh: bool = False) -> pd.DataFrame:
    """Return a (field, symbol) MultiIndex frame, cached as Parquet.

    TODO(week 1) — implement with yfinance:

        import yfinance as yf
        raw = yf.download(symbols, start=start, end=end,
                          auto_adjust=True, progress=False)

    Reshape so columns are (field, symbol) with lowercase field names, run
    validate() on the result, and write one Parquet file per symbol into CACHE.
    Read from cache when the file exists and refresh is False.
    """
    raise NotImplementedError("Week 1 task — see docstring")


def validate(prices: pd.DataFrame, max_daily_move: float = 0.25) -> pd.DataFrame:
    """Flag suspicious rows instead of silently trusting the feed.

    Returns a frame of issues: missing business days, non-positive prices, and
    moves larger than max_daily_move (usually an unadjusted split, not a crash).
    """
    issues: list[dict] = []
    closes = prices["close"]

    expected = pd.bdate_range(prices.index.min(), prices.index.max())
    for missing in expected.difference(prices.index):
        issues.append({"date": missing, "symbol": "*", "issue": "missing bar"})

    for sym in closes.columns:
        s = closes[sym]
        for date in s.index[s <= 0]:
            issues.append({"date": date, "symbol": sym, "issue": "non-positive price"})
        moves = s.pct_change().abs()
        for date in moves.index[moves > max_daily_move]:
            issues.append(
                {"date": date, "symbol": sym,
                 "issue": f"move {moves[date]:.1%} - check for a split"}
            )
    return pd.DataFrame(issues)
