"""Select momentum parameters on each train fold, then test once."""

from __future__ import annotations

import sys
from itertools import product
from pathlib import Path

import numpy as np
import pandas as pd

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quantlab.core import BacktestEngine, CostModel, Strategy, rolling_folds
from quantlab.core.metrics import sharpe
from quantlab.strategies import BuyAndHold, MomentumRanking

DATASET = Path("data/processed/universe.parquet")
MONTHS = (3, 6, 9, 12)
TOP_K = (3, 5, 10)


class _TestOnly(Strategy):
    """Give indicators past context while preventing pre-test orders."""

    warmup = 1

    def __init__(self, strategy: Strategy, test_start: pd.Timestamp, use_train_history: bool):
        self.strategy = strategy
        self.test_start = test_start
        self.use_train_history = use_train_history

    def generate_weights(self, history: pd.DataFrame) -> pd.Series | None:
        if history.index[-1] < self.test_start:
            return None
        if not self.use_train_history:
            history = history.loc[history.index >= self.test_start]
        return self.strategy.generate_weights(history)


def select_on_train(train: pd.DataFrame, costs: CostModel) -> tuple[int, int, float]:
    """Choose solely by realistic-cost train Sharpe; ties follow grid order."""
    best = None
    best_score = -np.inf
    for months, k in product(MONTHS, TOP_K):
        result = BacktestEngine(train, costs=costs).run(MomentumRanking(months, k))
        score = sharpe(result.returns)
        if np.isfinite(score) and score > best_score:
            best = (months, k, score)
            best_score = score
    if best is None:
        raise ValueError("No parameter pair produced a finite train Sharpe")
    return best


def _test_sharpe(
    train: pd.DataFrame, test: pd.DataFrame, strategy: Strategy,
    costs: CostModel, use_train_history: bool,
) -> float:
    context = pd.concat([train, test])
    result = BacktestEngine(context, costs=costs).run(
        _TestOnly(strategy, test.index[0], use_train_history)
    )
    # The final train close is flat cash; include it to capture the first
    # test-day return while excluding all earlier train-period returns.
    test_equity = result.equity.loc[train.index[-1]:]
    return sharpe(test_equity.pct_change().dropna())


def run_sweep(
    prices: pd.DataFrame, train_years: int = 3, test_years: int = 1,
    costs: CostModel | None = None,
) -> pd.DataFrame:
    """Return train and test Sharpe for one train-selected pair per fold."""
    folds = rolling_folds(prices, train_years, test_years)
    if not folds:
        raise ValueError("Not enough calendar years for a walk-forward fold")
    realistic = costs or CostModel()
    rows = []
    for fold in folds:
        months, k, selected_train_sharpe = select_on_train(fold.train, realistic)
        for cost_label, cost_model in (("0 bps", CostModel(0, 0, 0)), ("realistic", realistic)):
            selected = MomentumRanking(months, k)
            train_score = (
                selected_train_sharpe if cost_label == "realistic"
                else sharpe(BacktestEngine(fold.train, costs=cost_model).run(selected).returns)
            )
            train_baseline = sharpe(
                BacktestEngine(fold.train, costs=cost_model).run(BuyAndHold()).returns
            )
            test_score = _test_sharpe(
                fold.train, fold.test, MomentumRanking(months, k), cost_model, True
            )
            test_baseline = _test_sharpe(
                fold.train, fold.test, BuyAndHold(), cost_model, False
            )
            rows.append({
                "fold": fold.label, "N": months, "k": k, "cost_model": cost_label,
                "train_sharpe": train_score, "train_baseline_sharpe": train_baseline,
                "test_sharpe": test_score, "test_baseline_sharpe": test_baseline,
                "gap": train_score - test_score,
            })
    return pd.DataFrame(rows)


def print_report(report: pd.DataFrame) -> None:
    for cost_label, group in report.groupby("cost_model", sort=False):
        print(f"\n{cost_label}: train vs test Sharpe (train - test = gap)")
        columns = [
            "fold", "N", "k", "train_sharpe", "test_sharpe",
            "gap", "test_baseline_sharpe",
        ]
        print(group[columns].to_string(index=False, float_format=lambda value: f"{value:.3f}"))
        print(f"Average gap: {group['gap'].mean():.3f}")


def main() -> None:
    if not DATASET.is_file():
        raise FileNotFoundError(f"Dataset not found: {DATASET}. Run python scripts/build_dataset.py first.")
    report = run_sweep(pd.read_parquet(DATASET))
    print_report(report)


if __name__ == "__main__":
    main()
