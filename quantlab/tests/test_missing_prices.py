"""Unavailable securities are untradeable; missing quotes are not zero prices."""

import pandas as pd
import pytest

from quantlab.core import BacktestEngine, CostModel
from quantlab.strategies import BuyAndHold


def test_nan_prices_prevent_trades_and_preserve_held_equity():
    dates = pd.bdate_range("2024-01-01", periods=4)
    prices = pd.DataFrame(
        {
            ("open", "AAA"): [100.0, 100.0, float("nan"), 120.0],
            ("close", "AAA"): [100.0, 110.0, float("nan"), 120.0],
            ("open", "BBB"): [float("nan"), float("nan"), 50.0, 50.0],
            ("close", "BBB"): [float("nan"), float("nan"), 50.0, 50.0],
        },
        index=dates,
    )
    prices.columns = pd.MultiIndex.from_tuples(prices.columns)

    result = BacktestEngine(prices, costs=CostModel(0, 0, 0)).run(BuyAndHold())

    assert result.trades["timestamp"].tolist() == [dates[1]]
    assert result.trades["symbol"].tolist() == ["AAA"]
    assert result.positions.loc[dates[2], "AAA"] == result.positions.loc[dates[1], "AAA"]
    assert result.positions["BBB"].eq(0).all()
    assert result.equity.loc[dates[2]] == pytest.approx(result.equity.loc[dates[1]])
    assert result.equity.loc[dates[2]] > 0
