"""The tests that make the backtester trustworthy.

If you only ever write one test in this project, write the first one. A
backtester that can see the future produces beautiful, worthless results, and
the failure is silent — nothing crashes, the equity curve just looks amazing.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from quantlab.core import BacktestEngine, CostModel, Strategy
from quantlab.strategies import BuyAndHold


def make_prices(n: int = 60, symbols=("AAA", "BBB"), seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2024-01-01", periods=n)
    frames = {}
    for sym in symbols:
        close = 100 * np.exp(np.cumsum(rng.normal(0.0004, 0.01, n)))
        frames[("open", sym)] = close * (1 + rng.normal(0, 0.001, n))
        frames[("close", sym)] = close
    df = pd.DataFrame(frames, index=idx)
    df.columns = pd.MultiIndex.from_tuples(df.columns)
    return df.sort_index(axis=1)


class SpyStrategy(Strategy):
    """Records the last timestamp it was shown on each call."""

    warmup = 1

    def __init__(self) -> None:
        self.seen_last_timestamps: list[pd.Timestamp] = []

    def generate_weights(self, history: pd.DataFrame) -> pd.Series:
        self.seen_last_timestamps.append(history.index[-1])
        return pd.Series(0.0, index=history["close"].columns)


class FutureCheatStrategy(Strategy):
    """Perfect foresight over the interval the position is actually held.

    Subtle but important: a weight decided on bar t is entered at the open of
    t+1 and held until the open of t+2. So the return this strategy captures is
    open[t+2] / open[t+1] — NOT close[t+1] / close[t]. Getting this wrong was
    the first bug in this test file: a 'cheat' aimed at the wrong interval lost
    to buy-and-hold, which looks like the engine is safe when really the test
    was just miscalibrated. Know exactly which interval your signal predicts.
    """

    warmup = 1

    def __init__(self, full_data: pd.DataFrame) -> None:
        self.full = full_data

    def generate_weights(self, history: pd.DataFrame) -> pd.Series:
        symbols = history["close"].columns
        pos = self.full.index.get_loc(history.index[-1])
        if pos + 2 >= len(self.full):
            return pd.Series(0.0, index=symbols)
        entry = self.full["open"].iloc[pos + 1]
        exit_ = self.full["open"].iloc[pos + 2]
        return (exit_ > entry).astype(float) / len(symbols)


def test_strategy_never_sees_beyond_current_bar():
    prices = make_prices()
    spy = SpyStrategy()
    BacktestEngine(prices).run(spy)

    # Every slice handed to the strategy must end at a real bar, and the
    # engine must never hand over the final bar (nothing left to execute on).
    assert spy.seen_last_timestamps, "strategy was never called"
    assert all(ts in prices.index for ts in spy.seen_last_timestamps)
    assert max(spy.seen_last_timestamps) < prices.index[-1]
    # Strictly increasing: no re-reading the past, no skipping ahead.
    assert spy.seen_last_timestamps == sorted(set(spy.seen_last_timestamps))


def test_history_slice_is_a_prefix_of_prices():
    """Belt and braces: the slice must equal prices.iloc[:k], nothing more."""
    prices = make_prices(30)
    captured: list[pd.DataFrame] = []

    class Capture(Strategy):
        warmup = 1

        def generate_weights(self, history):
            captured.append(history)
            return pd.Series(0.0, index=history["close"].columns)

    BacktestEngine(prices).run(Capture())
    for hist in captured:
        k = len(hist)
        pd.testing.assert_frame_equal(hist, prices.iloc[:k])


def test_signals_execute_with_one_bar_delay():
    """A strategy that flips to fully long on bar 5 should hold nothing until
    bar 6's open."""
    prices = make_prices(20, symbols=("AAA",))
    flip_date = prices.index[5]

    class FlipOnce(Strategy):
        warmup = 1

        def generate_weights(self, history):
            weight = 1.0 if history.index[-1] >= flip_date else 0.0
            return pd.Series(weight, index=history["close"].columns)

    res = BacktestEngine(prices, costs=CostModel(0, 0, 0)).run(FlipOnce())
    assert res.positions.loc[flip_date, "AAA"] == 0.0        # decision bar
    assert res.positions.iloc[6]["AAA"] > 0.0                # executed next bar


def test_costs_reduce_returns():
    prices = make_prices(120)
    free = BacktestEngine(prices, costs=CostModel(0, 0, 0)).run(BuyAndHold())
    pricey = BacktestEngine(prices, costs=CostModel(10, 10, 10)).run(BuyAndHold())
    assert pricey.equity.iloc[-1] < free.equity.iloc[-1]
    assert pricey.costs_paid > 0


def test_cheating_strategy_cannot_help_itself_through_the_engine():
    """The engine gives the cheat only a prefix; it smuggles the future in via
    its own reference to the full frame. This test documents that the LEAK
    must come from the strategy, never the engine — and is a reminder to never
    pass full data into a strategy in real use."""
    prices = make_prices(150)
    cheat = BacktestEngine(prices, costs=CostModel(0, 0, 0)).run(
        FutureCheatStrategy(prices)
    )
    honest = BacktestEngine(prices, costs=CostModel(0, 0, 0)).run(BuyAndHold())
    # A perfect-foresight strategy trivially wins. If an honest strategy of
    # yours ever posts numbers in this neighbourhood, you have a bug.
    assert cheat.equity.iloc[-1] > honest.equity.iloc[-1]


def test_engine_rejects_unsorted_or_malformed_data():
    prices = make_prices(10)
    with pytest.raises(ValueError):
        BacktestEngine(prices.iloc[::-1])          # descending index
    with pytest.raises(ValueError):
        BacktestEngine(prices.drop(columns="open", level=0))
    flat = prices.copy()
    flat.columns = ["-".join(c) for c in flat.columns]
    with pytest.raises(ValueError):
        BacktestEngine(flat)                        # not a MultiIndex
