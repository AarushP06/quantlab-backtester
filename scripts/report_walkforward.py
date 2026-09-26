"""Print crossover walk-forward results for both baselines and market regimes."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quantlab.core import evaluate_walkforward, regime_breakdown, to_markdown
from quantlab.strategies import MovingAverageCrossover

DATASET = Path("data/processed/universe.parquet")


def main() -> None:
    if not DATASET.is_file():
        raise FileNotFoundError(f"Dataset not found: {DATASET}")
    prices = pd.read_parquet(DATASET)
    reports = {}
    for mode in ("never", "on_listing"):
        print(f"\nWalk-forward: crossover vs BuyAndHold[{mode}]", flush=True)
        report = evaluate_walkforward(
            prices, MovingAverageCrossover(20, 50),
            train_years=3, test_years=1, baseline_rebalance=mode,
        )
        reports[mode] = report
        print(to_markdown(report), flush=True)

    breakdown = regime_breakdown(reports)
    print("\nMean test-fold results by regime (drawdown / recovery / steady bull)")
    print(breakdown.to_string(index=False, float_format=lambda x: f"{x:.4f}"))


if __name__ == "__main__":
    main()
