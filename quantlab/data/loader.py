"""Data layer — build this first; it decides whether the rest is worth anything.

Rules that save weeks of confusion:
  1. Fetch once, cache to disk, never hit the network during a backtest.
  2. Validate on ingest, not when a result looks weird three weeks later.
  3. Use ADJUSTED closes, or splits look like -50% crashes.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pandas_market_calendars as mcal

CACHE = Path("data/cache")


def fetch(symbols: list[str], start: str, end: str, refresh: bool = False) -> pd.DataFrame:
    """Return a (field, symbol) MultiIndex frame, cached as Parquet.

    Reshape so columns are (field, symbol) with lowercase field names, run
    validate() on the result, and write one Parquet file per symbol into CACHE.
    Read from cache when the file exists and refresh is False.
    """
    if not symbols:
        raise ValueError("symbols must contain at least one symbol")

    symbols = list(dict.fromkeys(symbols))
    cached: dict[str, pd.DataFrame] = {}
    missing: list[str] = []
    for symbol in symbols:
        path = CACHE / f"{symbol}.parquet"
        if path.exists() and not refresh:
            cached[symbol] = pd.read_parquet(path)
        else:
            missing.append(symbol)

    downloaded: dict[str, pd.DataFrame] = {}
    if missing:
        import yfinance as yf

        raw = yf.download(
            missing, start=start, end=end, auto_adjust=True, progress=False
        )
        if raw.empty and len(raw.columns) == 0:
            raise ValueError(
                f"No market data returned for symbol(s): {', '.join(missing)}"
            )
        for symbol in missing:
            if isinstance(raw.columns, pd.MultiIndex):
                # yfinance normally returns (field, ticker), but also supports
                # (ticker, field) through its group_by option.
                if symbol in raw.columns.get_level_values(1):
                    frame = raw.xs(symbol, axis=1, level=1)
                elif symbol in raw.columns.get_level_values(0):
                    frame = raw.xs(symbol, axis=1, level=0)
                else:
                    raise ValueError(f"No market data returned for symbol {symbol!r}")
            elif len(missing) == 1:
                frame = raw.copy()
            else:
                raise ValueError("Expected per-symbol columns from yfinance")

            frame = frame.copy()
            frame.columns = frame.columns.astype(str).str.lower()
            frame = frame.dropna(how="all").sort_index()
            if frame.empty or not {"open", "close"}.issubset(frame.columns):
                raise ValueError(f"No market data returned for symbol {symbol!r}")
            downloaded[symbol] = frame

        CACHE.mkdir(parents=True, exist_ok=True)
        for symbol, frame in downloaded.items():
            frame.to_parquet(CACHE / f"{symbol}.parquet")

    frames = {**cached, **downloaded}
    for symbol, frame in frames.items():
        if frame.empty:
            raise ValueError(f"No market data returned for symbol {symbol!r}")
    prices = pd.concat(
        {symbol: frames[symbol] for symbol in symbols}, axis=1, names=["symbol", "field"]
    ).swaplevel(0, 1, axis=1).sort_index(axis=1)
    prices = prices.loc[(prices.index >= pd.Timestamp(start)) &
                        (prices.index < pd.Timestamp(end))]
    for symbol in symbols:
        if prices["close"][symbol].dropna().empty:
            raise ValueError(f"No market data returned for symbol {symbol!r} in requested range")
    validate(prices)
    return prices


def validate(prices: pd.DataFrame, max_daily_move: float = 0.25) -> pd.DataFrame:
    """Flag suspicious rows instead of silently trusting the feed.

    Returns a frame of issues: missing XNYS sessions, non-positive prices, and
    moves larger than max_daily_move (usually an unadjusted split, not a crash).
    """
    issues: list[dict] = []
    closes = prices["close"]

    expected = mcal.get_calendar("XNYS").schedule(
        start_date=prices.index.min(), end_date=prices.index.max()
    ).index
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
