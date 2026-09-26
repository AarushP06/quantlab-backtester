"""Classic moving-average crossover — a deliberately simple demo strategy.

Note what it does NOT do: peek at the current bar's close to decide and then
execute at that same close. It returns weights; the engine executes them at the
next open. Keep that discipline in every strategy you add.
"""

from __future__ import annotations

import pandas as pd

from ..core.strategy import Strategy


class MovingAverageCrossover(Strategy):
    def __init__(self, fast: int = 20, slow: int = 50) -> None:
        if fast >= slow:
            raise ValueError("fast window must be shorter than slow window")
        self.fast = fast
        self.slow = slow
        self.warmup = slow + 1

    @property
    def name(self) -> str:
        return f"MACross({self.fast}/{self.slow})"

    def generate_weights(self, history: pd.DataFrame) -> pd.Series:
        closes = history["close"]
        fast_ma = closes.rolling(self.fast).mean().iloc[-1]
        slow_ma = closes.rolling(self.slow).mean().iloc[-1]
        long_signal = (fast_ma > slow_ma).astype(float)
        n_long = long_signal.sum()
        if n_long == 0:
            return pd.Series(0.0, index=closes.columns)
        return long_signal / n_long
