"""Event-driven-ish backtest engine.

Vectorised backtests are fast but make lookahead bias easy to introduce by
accident. This engine walks bars forward one at a time: slower, far harder to
cheat in. At a few thousand bars x a few hundred symbols it is fast enough.

Timing model (memorise this):

    bar t close  -> strategy sees history[:t] and returns target weights
    bar t+1 open -> orders execute at that open, adjusted for slippage
    bar t+1 close-> portfolio marked to market, equity recorded

Anything that executes at the same bar the signal was computed on is a bug.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .strategy import Strategy


@dataclass(frozen=True)
class CostModel:
    """Transaction costs, in basis points of traded notional.

    commission_bps: broker fee. Retail equity is often 0 now.
    spread_bps:     half the bid-ask spread you cross on entry and exit.
    slippage_bps:   market impact / the price moving against you.

    Defaults are deliberately pessimistic. Run every strategy at
    CostModel(0, 0, 0) too, and report both — the gap between them tells you
    how much of the edge is real and how much is a rounding error.
    """

    commission_bps: float = 1.0
    spread_bps: float = 2.0
    slippage_bps: float = 2.0

    @property
    def total_bps(self) -> float:
        return self.commission_bps + self.spread_bps + self.slippage_bps

    def cost_of(self, traded_notional: float) -> float:
        return abs(traded_notional) * self.total_bps / 10_000.0


@dataclass
class BacktestResult:
    equity: pd.Series
    positions: pd.DataFrame
    trades: pd.DataFrame
    costs_paid: float
    strategy_name: str
    cost_model: CostModel
    meta: dict = field(default_factory=dict)

    @property
    def returns(self) -> pd.Series:
        return self.equity.pct_change().dropna()

    def __repr__(self) -> str:
        total = self.equity.iloc[-1] / self.equity.iloc[0] - 1
        return (
            f"<BacktestResult {self.strategy_name} "
            f"total_return={total:.1%} "
            f"costs=${self.costs_paid:,.0f} "
            f"trades={len(self.trades)}>"
        )


class BacktestEngine:
    """Walks bars forward, applying a strategy's target weights with a lag."""

    def __init__(
        self,
        prices: pd.DataFrame,
        initial_cash: float = 100_000.0,
        costs: CostModel | None = None,
        allow_fractional: bool = True,
    ) -> None:
        """
        Args:
            prices: MultiIndex columns (field, symbol), DatetimeIndex rows,
                sorted ascending. Must contain at least 'open' and 'close'.
            initial_cash: starting equity.
            costs: cost model; defaults to the pessimistic CostModel().
            allow_fractional: if False, share counts are floored to integers.
        """
        self._validate(prices)
        self.prices = prices.sort_index()
        self.initial_cash = float(initial_cash)
        self.costs = costs or CostModel()
        self.allow_fractional = allow_fractional
        self.symbols: list[str] = sorted(
            prices["close"].columns.tolist()  # type: ignore[index]
        )

    @staticmethod
    def _validate(prices: pd.DataFrame) -> None:
        if not isinstance(prices.columns, pd.MultiIndex):
            raise ValueError("prices needs MultiIndex columns: (field, symbol)")
        fields = set(prices.columns.get_level_values(0))
        missing = {"open", "close"} - fields
        if missing:
            raise ValueError(f"prices missing required fields: {sorted(missing)}")
        if not prices.index.is_monotonic_increasing:
            raise ValueError("prices index must be sorted ascending")
        if prices.index.has_duplicates:
            raise ValueError("prices index has duplicate timestamps")

    def run(self, strategy: Strategy) -> BacktestResult:
        idx = self.prices.index
        opens = self.prices["open"]
        closes = self.prices["close"]

        cash = self.initial_cash
        shares = pd.Series(0.0, index=self.symbols)
        pending: pd.Series | None = None  # weights decided on the previous bar

        equity_curve: list[float] = []
        position_log: list[pd.Series] = []
        trade_log: list[dict] = []
        costs_paid = 0.0

        for i, ts in enumerate(idx):
            # ---- 1. execute yesterday's decision at today's open ----------
            if pending is not None:
                px = opens.loc[ts]
                # Mark at the open to size orders against current equity.
                equity_at_open = cash + float((shares * px).fillna(0.0).sum())
                target_shares = self._weights_to_shares(pending, px, equity_at_open)
                delta = (target_shares - shares).fillna(0.0)

                for sym, d in delta.items():
                    if abs(d) < 1e-9 or not np.isfinite(px.get(sym, np.nan)):
                        continue
                    notional = d * px[sym]
                    fee = self.costs.cost_of(notional)
                    cash -= notional + fee
                    costs_paid += fee
                    shares[sym] = shares.get(sym, 0.0) + d
                    trade_log.append(
                        {
                            "timestamp": ts,
                            "symbol": sym,
                            "shares": d,
                            "price": float(px[sym]),
                            "notional": float(notional),
                            "cost": float(fee),
                        }
                    )
                pending = None

            # ---- 2. mark to market on today's close -----------------------
            close_px = closes.loc[ts]
            equity = cash + float((shares * close_px).fillna(0.0).sum())
            equity_curve.append(equity)
            position_log.append(shares.copy())

            # ---- 3. decide, using data only up to and including today -----
            if i + 1 < len(idx) and i + 1 >= strategy.warmup:
                history = self.prices.iloc[: i + 1]  # inclusive slice, no future
                weights = strategy.generate_weights(history)
                pending = self._clean_weights(weights)

        return BacktestResult(
            equity=pd.Series(equity_curve, index=idx, name="equity"),
            positions=pd.DataFrame(position_log, index=idx),
            trades=pd.DataFrame(trade_log),
            costs_paid=costs_paid,
            strategy_name=strategy.name,
            cost_model=self.costs,
            meta={"initial_cash": self.initial_cash, "bars": len(idx)},
        )

    def _clean_weights(self, weights: pd.Series) -> pd.Series:
        w = pd.Series(weights, dtype=float).reindex(self.symbols).fillna(0.0)
        return w.replace([np.inf, -np.inf], 0.0)

    def _weights_to_shares(
        self, weights: pd.Series, prices: pd.Series, equity: float
    ) -> pd.Series:
        target_notional = weights * equity
        with np.errstate(divide="ignore", invalid="ignore"):
            shares = target_notional / prices
        shares = shares.replace([np.inf, -np.inf], np.nan).fillna(0.0)
        if not self.allow_fractional:
            shares = np.sign(shares) * np.floor(np.abs(shares))
        return shares.reindex(self.symbols).fillna(0.0)
