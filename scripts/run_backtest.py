"""Compare a 20/50 moving-average crossover with buy-and-hold."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

# Allow `python scripts/run_backtest.py` from the repository root.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quantlab.core import BacktestEngine, CostModel, summarise
from quantlab.strategies import BuyAndHold, MovingAverageCrossover

DATASET = Path("data/processed/universe.parquet")


def run_backtests(path: Path = DATASET) -> dict[str, pd.DataFrame]:
    """Run both strategies on identical bars under both cost assumptions."""
    if not path.is_file():
        raise FileNotFoundError(
            f"Dataset not found: {path}. Run python scripts/build_dataset.py first."
        )
    prices = pd.read_parquet(path)
    tables = {}
    for label, costs in (
        ("0 bps", CostModel(0, 0, 0)),
        ("Default costs (5 bps)", CostModel()),
    ):
        result = BacktestEngine(prices, costs=costs).run(
            MovingAverageCrossover(20, 50)
        )
        baseline = BacktestEngine(prices, costs=costs).run(BuyAndHold())
        table = summarise(result, baseline)
        tables[label] = table
        print(f"\n{label}\n{table.to_string()}")
    return tables


if __name__ == "__main__":
    run_backtests()
