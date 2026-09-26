"""Holding a position is distinct from submitting target weights again."""

import pandas as pd
import pytest

from quantlab.core import BacktestEngine, CostModel, Strategy
from quantlab.strategies import BuyAndHold


def prices():
    dates = pd.bdate_range("2024-01-29", periods=8)
    frame = pd.DataFrame(
        {
            ("open", "AAA"): [100, 101, 102, 103, 104, 105, 106, 107],
            ("close", "AAA"): [100, 101, 102, 103, 104, 105, 106, 107],
            ("open", "BBB"): [100, 100, 100, 100, 100, 100, 100, 100],
            ("close", "BBB"): [100, 100, 100, 100, 100, 100, 100, 100],
        },
        index=dates,
    )
    frame.columns = pd.MultiIndex.from_tuples(frame.columns)
    return frame


def test_never_rebalances_on_exactly_one_trading_day():
    result = BacktestEngine(prices(), costs=CostModel(0, 0, 0)).run(BuyAndHold())

    assert result.trades["timestamp"].nunique() == 1
    assert result.trades["timestamp"].iloc[0] == result.equity.index[1]
    assert len(result.trades) == 2
    pd.testing.assert_frame_equal(
        result.positions.iloc[1:],
        pd.DataFrame(
            [result.positions.iloc[1]] * (len(result.positions) - 1),
            index=result.positions.index[1:],
        ),
    )


def test_on_listing_rebalances_only_after_first_available_bar():
    data = prices().astype(float)
    data.loc[data.index[:3], ("open", "BBB")] = float("nan")
    data.loc[data.index[:3], ("close", "BBB")] = float("nan")

    never = BacktestEngine(data, costs=CostModel(0, 0, 0)).run(BuyAndHold())
    on_listing = BacktestEngine(data, costs=CostModel(0, 0, 0)).run(
        BuyAndHold(rebalance="on_listing")
    )

    assert set(never.trades["timestamp"]) == {data.index[1]}
    assert set(never.trades["symbol"]) == {"AAA"}
    assert set(on_listing.trades["timestamp"]) == {data.index[1], data.index[4]}
    assert on_listing.positions.loc[data.index[3], "BBB"] == 0
    assert on_listing.positions.loc[data.index[4], "BBB"] > 0
    assert on_listing.positions.loc[data.index[1], "AAA"] > never.positions.loc[
        data.index[1], "AAA"
    ]
    assert (on_listing.positions.iloc[4:] == on_listing.positions.iloc[4]).all().all()


def test_none_signal_holds_initial_shares_without_further_trades():
    class EnterThenHold(Strategy):
        warmup = 1

        def generate_weights(self, history):
            if len(history) == 1:
                return pd.Series(1.0, index=history["close"].columns)
            return None

    result = BacktestEngine(prices(), costs=CostModel(0, 0, 0)).run(EnterThenHold())

    assert set(result.trades["timestamp"]) == {result.equity.index[1]}
    assert (result.positions.iloc[1:] == result.positions.iloc[1]).all().all()


def test_monthly_rebalances_after_first_bar_of_new_month():
    data = prices()
    result = BacktestEngine(data, costs=CostModel(0, 0, 0)).run(
        BuyAndHold(rebalance="monthly")
    )

    assert set(result.trades["timestamp"]) == {data.index[1], data.index[4]}


def test_daily_rebalances_and_invalid_frequency_is_rejected():
    result = BacktestEngine(prices(), costs=CostModel(0, 0, 0)).run(
        BuyAndHold(rebalance="daily")
    )

    assert result.trades["timestamp"].nunique() > 1
    with pytest.raises(ValueError, match="rebalance"):
        BuyAndHold(rebalance="weekly")
