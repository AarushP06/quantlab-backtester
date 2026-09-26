"""Export backtest metrics and equity curves for the static viewer.

Run locally after updating the committed Parquet snapshot. The exported JSON
is the entire data source for ``static/index.html``; deployment never runs
Python, fetches prices, or executes a strategy.
"""

from __future__ import annotations

import json
import math
import sys
from collections.abc import Callable
from pathlib import Path

import pandas as pd

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quantlab.core import BacktestEngine, CostModel, Strategy, rolling_folds, summarise
from quantlab.strategies import BuyAndHold, MomentumRanking, MovingAverageCrossover

DATASET = Path("data/processed/universe.parquet")
OUTPUT = Path("static/data")
STRATEGIES: dict[str, tuple[str, Callable[[], Strategy]]] = {
    "ma_20_50": ("Moving average crossover (20/50)", lambda: MovingAverageCrossover(20, 50)),
    "momentum_6_5": ("Momentum ranking (6 months, top 5)", lambda: MomentumRanking(6, 5)),
    "buy_hold_never": ("Buy and hold · never", lambda: BuyAndHold("never")),
    "buy_hold_on_listing": ("Buy and hold · on listing", lambda: BuyAndHold("on_listing")),
    "buy_hold_monthly": ("Buy and hold · monthly", lambda: BuyAndHold("monthly")),
    "buy_hold_daily": ("Buy and hold · daily", lambda: BuyAndHold("daily")),
}
COSTS = {"0": CostModel(0, 0, 0), "5": CostModel()}
METRICS = {
    "Total return": "total_return",
    "CAGR": "cagr",
    "Sharpe": "sharpe",
    "Max drawdown": "max_drawdown",
    "Turnover (x/yr)": "turnover",
    "Costs paid": "costs_paid",
    "Trades": "trades",
}


def _finite_number(value: float) -> float | None:
    number = float(value)
    return number if math.isfinite(number) else None


def _result_payload(result) -> dict:
    values = summarise(result).iloc[:, 0]
    metrics = {key: _finite_number(values[name]) for name, key in METRICS.items()}
    metrics["trades"] = len(result.trades)
    return {
        "dates": [date.strftime("%Y-%m-%d") for date in result.equity.index],
        "equity": [round(float(value), 6) for value in result.equity],
        "metrics": metrics,
    }


def _write_json(path: Path, value: dict) -> None:
    with path.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, allow_nan=False, separators=(",", ":"))
        stream.write("\n")


def build_results(
    prices: pd.DataFrame,
    output_dir: Path = OUTPUT,
    strategies: dict[str, tuple[str, Callable[[], Strategy]]] | None = None,
) -> dict:
    """Precompute every configured strategy on full and test-fold periods."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    specs = STRATEGIES if strategies is None else strategies
    folds = rolling_folds(prices, train_years=3, test_years=1)
    if not folds:
        raise ValueError("Dataset needs at least three train years and one test year")

    periods = {"full": prices}
    period_labels = {"full": f"Full period · {prices.index[0]:%Y-%m-%d} to {prices.index[-1]:%Y-%m-%d}"}
    for fold in folds:
        year = str(fold.test.index[0].year)
        periods[year] = fold.test
        period_labels[year] = fold.label

    manifest = {
        "schema_version": 1,
        "source": "data/processed/universe.parquet",
        "first_date": prices.index[0].strftime("%Y-%m-%d"),
        "last_date": prices.index[-1].strftime("%Y-%m-%d"),
        "bars": len(prices),
        "symbols": len(prices["close"].columns),
        "periods": [{"id": key, "label": label} for key, label in period_labels.items()],
        "costs": [{"id": "0", "label": "0 bps"}, {"id": "5", "label": "5 bps"}],
        "strategies": [],
        "default_baseline": "buy_hold_never",
        "baseline_options": ["buy_hold_never", "buy_hold_on_listing"],
    }
    for strategy_id, (label, factory) in specs.items():
        files = {}
        for cost_id, cost_model in COSTS.items():
            scenarios = {}
            for period_id, frame in periods.items():
                result = BacktestEngine(frame, costs=cost_model).run(factory())
                scenarios[period_id] = _result_payload(result)
            filename = f"{strategy_id}_{cost_id}.json"
            _write_json(output_dir / filename, {"periods": scenarios})
            files[cost_id] = f"data/{filename}"
        manifest["strategies"].append({"id": strategy_id, "label": label, "files": files})
        print(f"Exported {label}: {len(periods)} periods × {len(COSTS)} costs", flush=True)

    _write_json(output_dir / "manifest.json", manifest)
    return manifest


def main() -> None:
    if not DATASET.is_file():
        raise FileNotFoundError(f"Dataset not found: {DATASET}")
    manifest = build_results(pd.read_parquet(DATASET))
    print(
        f"Wrote {len(manifest['strategies']) * len(COSTS) + 1} JSON files "
        f"to {OUTPUT} for {len(manifest['periods']) - 1} walk-forward folds."
    )


if __name__ == "__main__":
    main()
