"""Monthly ranking by trailing adjusted-close return."""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..core.strategy import Strategy


class MomentumRanking(Strategy):
    """Hold the top ``k`` symbols by trailing ``months``-month return.

    Rank on the first observed bar of each month. The engine executes the
    resulting weights at the next bar's open. Hold shares between signals.
    """

    warmup = 1

    def __init__(self, months: int, k: int) -> None:
        if months < 1 or k < 1:
            raise ValueError("months and k must be positive")
        self.months = months
        self.k = k

    @property
    def name(self) -> str:
        return f"Momentum({self.months}m, top {self.k})"

    def generate_weights(self, history: pd.DataFrame) -> pd.Series | None:
        if len(history) > 1 and history.index[-1].to_period("M") == history.index[-2].to_period("M"):
            return None

        closes = history["close"]
        cutoff = history.index[-1] - pd.DateOffset(months=self.months)
        older = closes.loc[:cutoff]
        if older.empty:
            return None
        trailing = closes.iloc[-1] / older.iloc[-1] - 1
        trailing = trailing.replace([np.inf, -np.inf], np.nan).dropna()
        if len(trailing) < self.k:
            return None
        winners = trailing.sort_index().sort_values(ascending=False, kind="stable").head(self.k)
        weights = pd.Series(0.0, index=closes.columns)
        weights.loc[winners.index] = 1.0 / self.k
        return weights
