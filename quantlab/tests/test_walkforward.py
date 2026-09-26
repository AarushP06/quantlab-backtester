"""Walk-forward slices and reports stay chronological and out of sample."""

import pandas as pd
import pytest

from quantlab.core import (
    CostModel,
    Strategy,
    evaluate_walkforward,
    regime_breakdown,
    rolling_folds,
    to_markdown,
)


def yearly_prices():
    dates = pd.DatetimeIndex(
        pd.Timestamp(year, 1, day)
        for year in range(2020, 2026)
        for day in (2, 3, 6, 7)
    )
    values = list(range(100, 100 + len(dates)))
    frame = pd.DataFrame(
        {("open", "AAA"): values, ("close", "AAA"): values}, index=dates
    )
    frame.columns = pd.MultiIndex.from_tuples(frame.columns)
    return frame


class StayFlat(Strategy):
    warmup = 1

    def generate_weights(self, history):
        return pd.Series(0.0, index=history["close"].columns)


def test_fold_train_and_test_periods_do_not_overlap():
    folds = rolling_folds(yearly_prices(), train_years=2, test_years=2)

    assert len(folds) == 2
    for fold in folds:
        assert fold.train.index.intersection(fold.test.index).empty
        assert fold.train.index.max() < fold.test.index.min()
    assert folds[0].test.index.intersection(folds[1].test.index).empty


def test_folds_are_chronological():
    folds = rolling_folds(yearly_prices(), train_years=2, test_years=1)

    assert [fold.test.index.min().year for fold in folds] == [2022, 2023, 2024, 2025]
    assert all(
        folds[i].test.index.max() < folds[i + 1].test.index.min()
        for i in range(len(folds) - 1)
    )


def test_evaluation_reports_long_rows_and_compounded_aggregate_with_baseline(capsys):
    report = evaluate_walkforward(
        yearly_prices(), StayFlat(), train_years=2, test_years=2,
        costs=CostModel(1, 2, 2),
    )

    assert list(report.columns) == [
        "fold", "strategy", "cost_model", "CAGR", "Sharpe", "MaxDD",
        "Turnover", "Costs", "Trades",
    ]
    assert len(report) == 12  # two folds plus aggregate, two strategies, two costs
    assert not report.duplicated(["fold", "strategy", "cost_model"]).any()
    assert list(report["fold"].drop_duplicates()) == [
        "train 2020-2021 / test 2022-2023",
        "train 2022-2023 / test 2024-2025",
        "aggregate",
    ]
    assert set(report["cost_model"]) == {"0 bps", "realistic"}
    assert (report.loc[report["strategy"] == "StayFlat", "CAGR"] == 0).all()
    baseline = report[report["strategy"] == "BuyAndHold (baseline)"]
    assert (baseline["CAGR"] > 0).all()
    assert (baseline.loc[baseline["cost_model"] == "0 bps", "Costs"] == 0).all()
    assert (baseline.loc[baseline["cost_model"] == "realistic", "Costs"] > 0).all()
    assert "Realistic-cost CAGR by fold" in capsys.readouterr().out


def test_markdown_helper_produces_readme_table(capsys):
    report = evaluate_walkforward(yearly_prices(), StayFlat(), train_years=2, test_years=2)
    markdown = to_markdown(report)

    assert markdown.startswith("| fold | strategy | cost_model | CAGR |")
    assert "| aggregate | StayFlat | realistic |" in markdown
    assert len(markdown.splitlines()) == len(report) + 2
    assert "train 2020-2021 / test 2022-2023" in capsys.readouterr().out


def test_on_listing_baseline_and_regime_averages_exclude_aggregate(capsys):
    never = evaluate_walkforward(yearly_prices(), StayFlat(), train_years=2)
    on_listing = evaluate_walkforward(
        yearly_prices(), StayFlat(), train_years=2,
        baseline_rebalance="on_listing",
    )
    assert "BuyAndHold[on_listing] (baseline)" in set(on_listing["strategy"])

    summary = regime_breakdown(
        {"never": never, "on_listing": on_listing},
        drawdown_years=frozenset({2022}),
        recovery_years=frozenset({2023}),
    )
    assert len(summary) == 12  # two modes, two costs, three regimes
    assert set(summary["regime"]) == {
        "sustained drawdown", "recovery", "steady bull",
    }
    assert set(summary["folds"]) == {1, 2}
    assert (summary["strategy_CAGR"] == 0).all()
    assert (summary["baseline_CAGR"] > 0).all()
    assert (summary["strategy_MaxDD"] == 0).all()
    assert (summary["baseline_MaxDD"] <= 0).all()

    with pytest.raises(ValueError, match="overlap"):
        regime_breakdown(
            {"never": never},
            drawdown_years=frozenset({2022}),
            recovery_years=frozenset({2022}),
        )
