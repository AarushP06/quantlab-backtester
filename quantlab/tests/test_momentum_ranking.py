"""Momentum ranking uses trailing history and trades only after signals."""

import pandas as pd
import pytest

from quantlab.core import BacktestEngine, CostModel
from quantlab.strategies import MomentumRanking


def prices():
    dates = pd.bdate_range("2023-01-02", "2023-04-06")
    count = len(dates)
    frame = pd.DataFrame(
        {
            ("open", "AAA"): range(100, 100 + count),
            ("close", "AAA"): range(100, 100 + count),
            ("open", "BBB"): range(200, 200 - count, -1),
            ("close", "BBB"): range(200, 200 - count, -1),
        },
        index=dates,
    )
    frame.columns = pd.MultiIndex.from_tuples(frame.columns)
    return frame


def test_ranks_trailing_three_months_then_holds_until_next_month():
    data = prices()
    strategy = MomentumRanking(3, 1)
    april_first = data.index[data.index.month == 4][0]
    history = data.loc[:april_first]

    assert strategy.generate_weights(history).to_dict() == {"AAA": 1.0, "BBB": 0.0}
    assert strategy.generate_weights(data.loc[:data.index[data.index.month == 4][1]]) is None

    result = BacktestEngine(data, costs=CostModel(0, 0, 0)).run(MomentumRanking(3, 1))
    assert set(result.trades["timestamp"]) == {data.index[data.index.month == 4][1]}
    assert set(result.trades["symbol"]) == {"AAA"}


def test_rejects_invalid_momentum_parameters():
    with pytest.raises(ValueError):
        MomentumRanking(0, 1)
    with pytest.raises(ValueError):
        MomentumRanking(3, 0)
