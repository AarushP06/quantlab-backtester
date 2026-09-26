"""Walk-forward evaluation.

A single train/test split invites you to tweak until the test set passes, which
is overfitting with extra steps. These folds reserve rolling training windows
and evaluate the following, non-overlapping test periods. The evaluator runs a
fixed strategy and does not fit models on the training slices.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from ..strategies.buy_hold import BuyAndHold
from .engine import BacktestEngine, BacktestResult, CostModel
from .metrics import summarise
from .strategy import Strategy


@dataclass
class Fold:
    train: pd.DataFrame
    test: pd.DataFrame
    label: str


def rolling_folds(
    prices: pd.DataFrame, train_years: int = 3, test_years: int = 1
) -> list[Fold]:
    """Split by calendar year with non-overlapping, chronological test periods."""
    if train_years < 1 or test_years < 1:
        raise ValueError("train_years and test_years must be positive")
    years = sorted({ts.year for ts in prices.index})
    folds: list[Fold] = []
    for i in range(0, len(years) - train_years - test_years + 1, test_years):
        tr = years[i : i + train_years]
        te = years[i + train_years : i + train_years + test_years]
        folds.append(
            Fold(
                train=prices[prices.index.year.isin(tr)],
                test=prices[prices.index.year.isin(te)],
                label=f"train {tr[0]}-{tr[-1]} / test {te[0]}-{te[-1]}",
            )
        )
    return folds


def _combine_results(results: list[BacktestResult]) -> BacktestResult:
    """Compound independent test-period equity paths for aggregate metrics."""
    initial_cash = results[0].meta["initial_cash"]
    capital = initial_cash
    equity_parts = []
    trade_parts = []
    costs_paid = 0.0
    for result in results:
        scale = capital / result.meta["initial_cash"]
        equity_parts.append(result.equity * scale)
        if not result.trades.empty:
            trades = result.trades.copy()
            trades["notional"] *= scale
            trades["cost"] *= scale
            trade_parts.append(trades)
        costs_paid += result.costs_paid * scale
        capital = result.equity.iloc[-1] * scale
    return BacktestResult(
        equity=pd.concat(equity_parts),
        positions=pd.DataFrame(),
        trades=pd.concat(trade_parts, ignore_index=True) if trade_parts else pd.DataFrame(),
        costs_paid=costs_paid,
        strategy_name=results[0].strategy_name,
        cost_model=results[0].cost_model,
        meta={"initial_cash": initial_cash},
    )


def evaluate_walkforward(
    prices: pd.DataFrame,
    strategy: Strategy,
    train_years: int = 3,
    test_years: int = 1,
    costs: CostModel | None = None,
    baseline_rebalance: str = "never",
) -> pd.DataFrame:
    """Evaluate a fixed strategy on each test slice against buy-and-hold.

    Each row identifies a fold, strategy, and cost model. Select the baseline
    with ``baseline_rebalance``; the default retains historical reports.
    The aggregate compounds independent test-period equity paths; it does
    not average fold returns. This function does not fit or tune on train.
    """
    folds = rolling_folds(prices, train_years, test_years)
    if not folds:
        raise ValueError("Not enough calendar years for a walk-forward fold")
    if baseline_rebalance not in {"never", "on_listing", "monthly", "daily"}:
        raise ValueError("Invalid baseline rebalance mode")

    scenarios = {"0 bps": CostModel(0, 0, 0), "realistic": costs or CostModel()}
    rows = []
    aggregate_rows = []
    for scenario, cost_model in scenarios.items():
        strategy_results = []
        baseline_results = []
        for fold in folds:
            strategy_result = BacktestEngine(fold.test, costs=cost_model).run(strategy)
            baseline_result = BacktestEngine(fold.test, costs=cost_model).run(
                BuyAndHold(rebalance=baseline_rebalance)
            )
            if baseline_rebalance != "never":
                baseline_result.strategy_name = f"BuyAndHold[{baseline_rebalance}]"
            strategy_results.append(strategy_result)
            baseline_results.append(baseline_result)
            rows.extend(_metric_rows(fold.label, scenario, strategy_result, baseline_result))
        aggregate_rows.extend(
            _metric_rows(
                "aggregate", scenario,
                _combine_results(strategy_results), _combine_results(baseline_results),
            )
        )

    report = pd.DataFrame(rows + aggregate_rows)
    print_compact_summary(report)
    return report


def _metric_rows(
    fold: str, cost_model: str, result: BacktestResult, baseline: BacktestResult
) -> list[dict]:
    comparison = summarise(result, baseline)
    return [
        {
            "fold": fold,
            "strategy": name,
            "cost_model": cost_model,
            "CAGR": metrics["CAGR"],
            "Sharpe": metrics["Sharpe"],
            "MaxDD": metrics["Max drawdown"],
            "Turnover": metrics["Turnover (x/yr)"],
            "Costs": metrics["Costs paid"],
            "Trades": int(metrics["Trades"]),
        }
        for name, metrics in comparison.items()
    ]


def print_compact_summary(report: pd.DataFrame) -> None:
    """Print each fold's strategy and baseline CAGR at realistic costs."""
    realistic = report[(report["cost_model"] == "realistic") & (report["fold"] != "aggregate")]
    print("Realistic-cost CAGR by fold (strategy / baseline / difference in pp):")
    for fold, group in realistic.groupby("fold", sort=False):
        strategy_cagr = group.loc[~group["strategy"].str.endswith("(baseline)"), "CAGR"].iloc[0]
        baseline_cagr = group.loc[group["strategy"].str.endswith("(baseline)"), "CAGR"].iloc[0]
        print(
            f"{fold}: {strategy_cagr:.2%} / {baseline_cagr:.2%} / "
            f"{(strategy_cagr - baseline_cagr) * 100:+.2f} pp"
        )


def to_markdown(report: pd.DataFrame) -> str:
    """Render the long-format report as a README-ready Markdown table."""
    columns = [
        "fold", "strategy", "cost_model", "CAGR", "Sharpe", "MaxDD",
        "Turnover", "Costs", "Trades",
    ]
    header = "| " + " | ".join(columns) + " |"
    separator = "| " + " | ".join("---" for _ in columns) + " |"
    lines = [header, separator]
    for row in report[columns].itertuples(index=False, name=None):
        fold, strategy, cost_model, cagr, sharpe, maxdd, turnover, costs, trades = row
        cells = [
            fold, strategy, cost_model, f"{cagr:.2%}", f"{sharpe:.2f}",
            f"{maxdd:.2%}", f"{turnover:.2f}", f"{costs:,.2f}", str(trades),
        ]
        lines.append("| " + " | ".join(str(cell).replace("|", "\\|") for cell in cells) + " |")
    return "\n".join(lines)


def regime_breakdown(
    reports: dict[str, pd.DataFrame],
    drawdown_years: frozenset[int] = frozenset({2008, 2018, 2022}),
    recovery_years: frozenset[int] = frozenset({2009, 2020}),
) -> pd.DataFrame:
    """Average test-fold CAGR, Sharpe, and MaxDD by regime and baseline.

    Each calendar test fold has equal weight. Aggregate rows are excluded;
    a partial final year still counts as one fold if present.
    """
    if drawdown_years & recovery_years:
        raise ValueError("Drawdown and recovery years must not overlap")

    def classify_regime(label: str) -> str:
        year = int(label.rsplit("test ", 1)[1][:4])
        if year in drawdown_years:
            return "sustained drawdown"
        if year in recovery_years:
            return "recovery"
        return "steady bull"

    rows = []
    for baseline_mode, report in reports.items():
        folds = report.loc[report["fold"] != "aggregate"].copy()
        folds["regime"] = folds["fold"].map(classify_regime)
        for (cost_model, regime_name), group in folds.groupby(
            ["cost_model", "regime"], sort=False
        ):
            baseline = group[group["strategy"].str.endswith("(baseline)")]
            strategy = group[~group["strategy"].str.endswith("(baseline)")]
            rows.append({
                "baseline_mode": baseline_mode,
                "cost_model": cost_model,
                "regime": regime_name,
                "folds": strategy["fold"].nunique(),
                "strategy_CAGR": strategy["CAGR"].mean(),
                "baseline_CAGR": baseline["CAGR"].mean(),
                "strategy_Sharpe": strategy["Sharpe"].mean(),
                "baseline_Sharpe": baseline["Sharpe"].mean(),
                "strategy_MaxDD": strategy["MaxDD"].mean(),
                "baseline_MaxDD": baseline["MaxDD"].mean(),
            })
    return pd.DataFrame(rows)
