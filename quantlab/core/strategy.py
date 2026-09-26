"""Strategy interface.

A Strategy converts market data into TARGET WEIGHTS: for each asset, the
fraction of portfolio equity you want to hold. 1.0 = fully long, 0.0 = flat,
-0.5 = half short. Weights (not share counts) keep strategies independent of
capital size and make multi-asset portfolios natural.

THE CONTRACT — the single most important rule in this codebase:

    generate_weights(history) receives ONLY data up to and including bar t.
    The weights it returns are executed at bar t+1's open.

The engine enforces the slicing, so a strategy physically cannot see the
future. Do not work around this by loading data inside a strategy.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import pandas as pd


class Strategy(ABC):
    """Base class for all strategies.

    Subclasses implement `generate_weights`. Keep them stateless where
    possible: the engine may reuse an instance across walk-forward folds.
    """

    #: Bars of history required before the strategy produces signals.
    #: The engine stays flat until this many bars are available.
    warmup: int = 0

    @property
    def name(self) -> str:
        return type(self).__name__

    @abstractmethod
    def generate_weights(self, history: pd.DataFrame) -> pd.Series:
        """Return target weights given all data up to and including now.

        Args:
            history: DataFrame indexed by timestamp, with a column MultiIndex
                of (field, symbol) where field is one of
                open/high/low/close/volume. The LAST row is the current bar.

        Returns:
            Series indexed by symbol holding target weights. Missing symbols
            are treated as 0.0. The engine does not normalise for you — if
            you return weights summing to 3.0 you are 3x levered, which the
            engine will honour and the cost model will punish.
        """
        raise NotImplementedError

    def __repr__(self) -> str:
        return f"<{self.name} warmup={self.warmup}>"
