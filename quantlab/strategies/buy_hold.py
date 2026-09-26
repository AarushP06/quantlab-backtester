"""The baseline you must beat. If you can't, that is the result — report it."""

from __future__ import annotations

import pandas as pd

from ..core.strategy import Strategy


class BuyAndHold(Strategy):
    """Start equally weighted; optionally reset target weights later.

    Decisions on a bar execute at the next bar's open. Monthly rebalancing is
    signaled on the first observed bar of each new calendar month.
    """

    warmup = 1

    def __init__(self, rebalance: str = "never") -> None:
        if rebalance not in {"never", "monthly", "daily"}:
            raise ValueError("rebalance must be 'never', 'monthly', or 'daily'")
        self.rebalance = rebalance

    def generate_weights(self, history: pd.DataFrame) -> pd.Series | None:
        if len(history) > 1:
            if self.rebalance == "never":
                return None
            if self.rebalance == "monthly":
                current, previous = history.index[-1], history.index[-2]
                if current.to_period("M") == previous.to_period("M"):
                    return None
        symbols = history["close"].columns
        return pd.Series(1.0 / len(symbols), index=symbols)
