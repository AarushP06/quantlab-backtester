"""The baseline you must beat. If you can't, that is the result — report it."""

from __future__ import annotations

import pandas as pd

from ..core.strategy import Strategy


class BuyAndHold(Strategy):
    """Start equally weighted; optionally reset target weights later.

    Decisions on a bar execute at the next bar's open. Monthly rebalancing is
    signaled on the first observed bar of each new calendar month. The
    ``on_listing`` mode rebalances only when a symbol first has a close.
    """

    warmup = 1

    def __init__(self, rebalance: str = "never") -> None:
        if rebalance not in {"never", "on_listing", "monthly", "daily"}:
            raise ValueError(
                "rebalance must be 'never', 'on_listing', 'monthly', or 'daily'"
            )
        self.rebalance = rebalance

    def generate_weights(self, history: pd.DataFrame) -> pd.Series | None:
        if self.rebalance == "on_listing":
            closes = history["close"]
            available = closes.notna().any(axis=0)
            if len(history) > 1:
                previously_available = closes.iloc[:-1].notna().any(axis=0)
                newly_available = closes.iloc[-1].notna() & ~previously_available
                if not newly_available.any():
                    return None
            if not available.any():
                return None
            weights = pd.Series(0.0, index=closes.columns)
            weights.loc[available] = 1.0 / available.sum()
            return weights

        if len(history) > 1:
            if self.rebalance == "never":
                return None
            if self.rebalance == "monthly":
                current, previous = history.index[-1], history.index[-2]
                if current.to_period("M") == previous.to_period("M"):
                    return None
        symbols = history["close"].columns
        return pd.Series(1.0 / len(symbols), index=symbols)
