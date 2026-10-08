"""Export adjusted daily stock history for the static market explorer."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pandas as pd

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quantlab.forecast import historical_analog_paths, historical_scenarios

DATASET = Path("data/processed/universe.parquet")
EXTRAS = Path("data/processed/market_extras.parquet")
OUTPUT = Path("static/data/market.json")


def _number(value: object) -> float | None:
    number = float(value)
    return round(number, 6) if math.isfinite(number) else None


def build_market_data(prices: pd.DataFrame, output: Path = OUTPUT,
                      source: str = str(DATASET)) -> dict:
    """Save one dated snapshot; never request data during a page view."""
    if prices.empty or not isinstance(prices.columns, pd.MultiIndex):
        raise ValueError("Expected a non-empty (field, symbol) price frame")
    if "close" not in prices.columns.get_level_values(0):
        raise ValueError("Price frame needs close columns")

    output = Path(output)
    paths_dir = output.parent / "forecast_paths"
    paths_dir.mkdir(parents=True, exist_ok=True)
    fields = set(prices.columns.get_level_values(0))
    symbols = {}
    for symbol in sorted(prices["close"].columns):
        closes = prices["close"][symbol].dropna()
        if closes.empty:
            raise ValueError(f"No adjusted close history for {symbol}")
        dates = [date.strftime("%Y-%m-%d") for date in closes.index]
        values = [_number(value) for value in closes]
        if any(value is None or value <= 0 for value in values):
            raise ValueError(f"Invalid adjusted close for {symbol}")
        prior = float(closes.iloc[-2]) if len(closes) > 1 else None
        last = float(closes.iloc[-1])
        trailing = closes.loc[closes.index >= closes.index[-1] - pd.DateOffset(years=1)]
        scenarios = historical_scenarios(closes)
        bars = pd.DataFrame({
            field: prices[field][symbol].loc[closes.index] if field in fields else closes
            for field in ("open", "high", "low", "close")
        })
        paths = historical_analog_paths(bars, scenarios)
        if set(paths) != set(scenarios):
            raise ValueError(f"Not enough valid OHLC history for {symbol} forecast paths")
        with (paths_dir / f"{symbol}.json").open("w", encoding="utf-8") as stream:
            json.dump(paths, stream, allow_nan=False, separators=(",", ":"))
            stream.write("\n")
        symbols[symbol] = {
            "first_date": dates[0],
            "last_date": dates[-1],
            "last_close": _number(last),
            "daily_change": _number(last / prior - 1) if prior else None,
            "year_low": _number(trailing.min()),
            "year_high": _number(trailing.max()),
            "dates": dates,
            "adjusted_close": values,
            "historical_scenarios": scenarios,
            "forecast_path": f"data/forecast_paths/{symbol}.json",
        }

    payload = {
        "schema_version": 1,
        "source": source,
        "as_of": prices.index[-1].strftime("%Y-%m-%d"),
        "price_type": "Adjusted daily close",
        "symbols": symbols,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as stream:
        json.dump(payload, stream, allow_nan=False, separators=(",", ":"))
        stream.write("\n")
    return payload


def main() -> None:
    if not DATASET.is_file():
        raise FileNotFoundError(f"Dataset not found: {DATASET}")
    prices = pd.read_parquet(DATASET)
    source = str(DATASET)
    if EXTRAS.is_file():
        extras = pd.read_parquet(EXTRAS)
        overlap = prices.columns.intersection(extras.columns)
        if not overlap.empty:
            raise ValueError(f"Extra market symbols overlap the backtest universe: {overlap.tolist()}")
        prices = pd.concat([prices, extras], axis=1).sort_index(axis=1)
        source = f"{DATASET} + {EXTRAS}"
    payload = build_market_data(prices, source=source)
    print(f"Exported {len(payload['symbols'])} symbols through {payload['as_of']} to {OUTPUT}")


if __name__ == "__main__":
    main()
