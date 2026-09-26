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
HORIZONS = (1, 3, 5, 10, 20)
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


def _window_payload(result) -> dict:
    """A fresh-window backtest expressed as value per $1 initially invested."""
    values = summarise(result).iloc[:, 0]
    initial_cash = result.meta["initial_cash"]
    return {
        "final_per_dollar": round(float(result.equity.iloc[-1] / initial_cash), 10),
        "equity_per_dollar": [
            round(float(value / initial_cash), 10) for value in result.equity
        ],
        "metrics": {
            "total_return": _finite_number(values["Total return"]),
            "cagr": _finite_number(values["CAGR"]),
            "max_drawdown": _finite_number(values["Max drawdown"]),
        },
    }


def rolling_windows(prices: pd.DataFrame) -> tuple[list[dict], dict[str, pd.DataFrame]]:
    """All calendar-year windows that fit the available annual history."""
    years = sorted({date.year for date in prices.index})
    available_years = set(years)
    windows = []
    frames = {}
    for horizon in HORIZONS:
        for start_year in years:
            end_year = start_year + horizon - 1
            if not set(range(start_year, end_year + 1)) <= available_years:
                continue
            frame = prices.loc[
                (prices.index.year >= start_year) & (prices.index.year <= end_year)
            ]
            window_id = f"{start_year}_{horizon}"
            frames[window_id] = frame
            windows.append({
                "id": window_id,
                "start_year": start_year,
                "end_year": end_year,
                "horizon": horizon,
                "first_date": frame.index[0].strftime("%Y-%m-%d"),
                "last_date": frame.index[-1].strftime("%Y-%m-%d"),
                "bars": len(frame),
            })
    return windows, frames


def _write_json(path: Path, value: dict) -> None:
    with path.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, allow_nan=False, separators=(",", ":"))
        stream.write("\n")


def build_results(
    prices: pd.DataFrame,
    output_dir: Path = OUTPUT,
    strategies: dict[str, tuple[str, Callable[[], Strategy]]] | None = None,
) -> dict:
    """Precompute every configured strategy on full, fold, and rolling windows."""
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
    windows, window_frames = rolling_windows(prices)
    _write_json(
        output_dir / "windows.json",
        {"dates": {
            window["id"]: [date.strftime("%Y-%m-%d") for date in window_frames[window["id"]].index]
            for window in windows
        }},
    )

    manifest = {
        "schema_version": 2,
        "source": "data/processed/universe.parquet",
        "first_date": prices.index[0].strftime("%Y-%m-%d"),
        "last_date": prices.index[-1].strftime("%Y-%m-%d"),
        "bars": len(prices),
        "symbols": len(prices["close"].columns),
        "periods": [{"id": key, "label": label} for key, label in period_labels.items()],
        "horizons": sorted({window["horizon"] for window in windows}),
        "windows": windows,
        "windows_file": "data/windows.json",
        "costs": [{"id": "0", "label": "0 bps"}, {"id": "5", "label": "5 bps"}],
        "strategies": [],
        "default_baseline": "buy_hold_never",
        "baseline_options": ["buy_hold_never", "buy_hold_on_listing"],
    }
    for strategy_id, (label, factory) in specs.items():
        files = {}
        simulator_files = {}
        for cost_id, cost_model in COSTS.items():
            scenarios = {}
            for period_id, frame in periods.items():
                result = BacktestEngine(frame, costs=cost_model).run(factory())
                scenarios[period_id] = _result_payload(result)
            filename = f"{strategy_id}_{cost_id}.json"
            _write_json(output_dir / filename, {"periods": scenarios})
            files[cost_id] = f"data/{filename}"
            window_results = {}
            for window in windows:
                result = BacktestEngine(
                    window_frames[window["id"]], costs=cost_model
                ).run(factory())
                window_results[window["id"]] = _window_payload(result)
            simulator_filename = f"simulator_{strategy_id}_{cost_id}.json"
            _write_json(
                output_dir / simulator_filename, {"windows": window_results}
            )
            simulator_files[cost_id] = f"data/{simulator_filename}"
            print(
                f"Exported {label} at {cost_id} bps: "
                f"{len(periods)} periods and {len(windows)} rolling windows",
                flush=True,
            )
        manifest["strategies"].append({
            "id": strategy_id,
            "label": label,
            "files": files,
            "simulator_files": simulator_files,
        })

    _write_json(output_dir / "manifest.json", manifest)
    return manifest


def main() -> None:
    if not DATASET.is_file():
        raise FileNotFoundError(f"Dataset not found: {DATASET}")
    manifest = build_results(pd.read_parquet(DATASET))
    print(
        f"Wrote {len(manifest['strategies']) * len(COSTS) * 2 + 2} JSON files "
        f"to {OUTPUT}: {len(manifest['periods']) - 1} folds and "
        f"{len(manifest['windows'])} rolling windows."
    )


if __name__ == "__main__":
    main()
