"""Performance metrics.

Every metric here is meaningless in isolation. A 15% CAGR is excellent or
terrible depending on what buy-and-hold did over the same window, so
`summarise` is built to take a baseline and show both side by side.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

TRADING_DAYS = 252


def cagr(equity: pd.Series, periods_per_year: int = TRADING_DAYS) -> float:
    if len(equity) < 2:
        return float("nan")
    years = len(equity) / periods_per_year
    return (equity.iloc[-1] / equity.iloc[0]) ** (1 / years) - 1


def volatility(returns: pd.Series, periods_per_year: int = TRADING_DAYS) -> float:
    return float(returns.std() * np.sqrt(periods_per_year))


def sharpe(
    returns: pd.Series,
    risk_free: float = 0.0,
    periods_per_year: int = TRADING_DAYS,
) -> float:
    """Annualised Sharpe. Anything above ~2 on daily equity data usually means
    a bug, not a discovery — check for lookahead before celebrating."""
    excess = returns - risk_free / periods_per_year
    if excess.std() == 0:
        return float("nan")
    return float(excess.mean() / excess.std() * np.sqrt(periods_per_year))


def max_drawdown(equity: pd.Series) -> float:
    """Worst peak-to-trough decline, as a negative number."""
    running_max = equity.cummax()
    return float((equity / running_max - 1).min())


def calmar(equity: pd.Series, periods_per_year: int = TRADING_DAYS) -> float:
    mdd = max_drawdown(equity)
    return float("nan") if mdd == 0 else cagr(equity, periods_per_year) / abs(mdd)


def turnover(trades: pd.DataFrame, equity: pd.Series) -> float:
    """Traded notional per year as a multiple of average equity. High turnover
    means the strategy is fragile to cost assumptions."""
    if trades.empty:
        return 0.0
    years = len(equity) / TRADING_DAYS
    return float(trades["notional"].abs().sum() / equity.mean() / years)


def summarise(result, baseline=None) -> pd.DataFrame:
    """Build a comparison table. Pass the baseline result — always."""

    def row(res) -> dict:
        eq, rets = res.equity, res.returns
        return {
            "Total return": eq.iloc[-1] / eq.iloc[0] - 1,
            "CAGR": cagr(eq),
            "Volatility": volatility(rets),
            "Sharpe": sharpe(rets),
            "Max drawdown": max_drawdown(eq),
            "Calmar": calmar(eq),
            "Turnover (x/yr)": turnover(res.trades, eq),
            "Costs paid": res.costs_paid,
            "Trades": len(res.trades),
        }

    data = {result.strategy_name: row(result)}
    if baseline is not None:
        data[f"{baseline.strategy_name} (baseline)"] = row(baseline)
    return pd.DataFrame(data)
