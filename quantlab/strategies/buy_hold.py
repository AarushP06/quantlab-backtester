"""The baseline you must beat. If you can't, that is the result — report it."""

from __future__ import annotations

import pandas as pd

from ..core.strategy import Strategy


class BuyAndHold(Strategy):
    """Equal weight across all symbols, rebalanced never (weights are constant,
    so the engine only trades on the first bar and on drift-free days does
    nothing)."""

    warmup = 1

    def generate_weights(self, history: pd.DataFrame) -> pd.Series:
        symbols = history["close"].columns
        return pd.Series(1.0 / len(symbols), index=symbols)
