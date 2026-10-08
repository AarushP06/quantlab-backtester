"""Historical stock outcome scenarios for the market explorer.

These are descriptions of past rolling returns, not estimates of future odds.
"""

from __future__ import annotations

import math

import pandas as pd


def _monthly_prices(closes: pd.Series) -> tuple[pd.Series, pd.Series]:
    if not isinstance(closes, pd.Series) or not isinstance(closes.index, pd.DatetimeIndex):
        raise TypeError("Expected adjusted closes indexed by dates")
    if closes.empty or closes.index.has_duplicates or not closes.index.is_monotonic_increasing:
        raise ValueError("Adjusted closes need unique, increasing dates")
    if closes.isna().any() or not closes.map(lambda value: math.isfinite(float(value)) and value > 0).all():
        raise ValueError("Adjusted closes must be finite and positive")
    month_ends = closes.groupby(closes.index.to_period("M")).tail(1)
    monthly = pd.Series(month_ends.to_numpy(), index=month_ends.index.to_period("M"))
    return month_ends, monthly


def historical_scenarios(
    closes: pd.Series, horizons: tuple[int, ...] = tuple(range(1, 21))
) -> dict[str, dict]:
    """Apply past same-horizon return percentiles to the last adjusted close.

    Month-end observations create a regular set of rolling windows. Windows
    overlap, so their count is not a count of independent outcomes.
    """
    month_ends, monthly = _monthly_prices(closes)
    if any(not isinstance(years, int) or years <= 0 for years in horizons):
        raise ValueError("Horizons must be positive whole years")

    latest = float(closes.iloc[-1])
    scenarios = {}
    for years in horizons:
        returns = (monthly / monthly.shift(12 * years, freq="M") - 1).dropna()
        if len(returns) < 12:
            continue
        estimates = {}
        for name, percentile in (("bearish", 0.1), ("moderate", 0.5), ("bullish", 0.9)):
            total_return = float(returns.quantile(percentile))
            estimates[name] = {
                "total_return": round(total_return, 6),
                "adjusted_price": round(latest * (1 + total_return), 2),
            }
        scenarios[str(years)] = {
            "years": years,
            "through_date": (closes.index[-1] + pd.DateOffset(years=years)).date().isoformat(),
            "window_count": len(returns),
            "first_window_end": month_ends.index[monthly.index.get_loc(returns.index[0])].date().isoformat(),
            "last_window_end": month_ends.index[monthly.index.get_loc(returns.index[-1])].date().isoformat(),
            "outcomes": estimates,
        }
    return scenarios


def historical_analog_paths(bars: pd.DataFrame, scenarios: dict[str, dict]) -> dict[str, dict]:
    """Replay past monthly OHLC shapes, adjusted to each scenario endpoint.

    The selected past window is the one whose total return is closest to the
    scenario percentile. Rescaling changes its trend while retaining its
    month-to-month variation. These paths are illustrations, not forecasts.
    """
    fields = ("open", "high", "low", "close")
    if not isinstance(bars, pd.DataFrame) or any(field not in bars for field in fields):
        raise ValueError("Expected open, high, low, and close columns")
    if not all(bars[field].dropna().map(lambda value: math.isfinite(float(value)) and value > 0).all()
               for field in fields):
        raise ValueError("OHLC values must be finite and positive")
    _monthly_prices(bars["close"].dropna())
    monthly = bars.resample("ME").agg({
        "open": "first", "high": "max", "low": "min", "close": "last"
    })
    monthly.index = monthly.index.to_period("M")
    monthly = monthly.reindex(pd.period_range(monthly.index[0], monthly.index[-1], freq="M"))
    latest_date = bars["close"].dropna().index[-1]
    latest_close = float(bars["close"].dropna().iloc[-1])
    paths = {}
    for year_key, scenario in scenarios.items():
        months = int(year_key) * 12
        candidates = []
        for start in range(len(monthly) - months - 1, -1, -1):
            window = monthly.iloc[start:start + months + 1]
            if window["close"].isna().any() or window.iloc[1:][list(fields)].isna().any().any():
                continue
            actual_ratio = float(window["close"].iloc[-1] / window["close"].iloc[0])
            if math.isfinite(actual_ratio) and actual_ratio > 0:
                candidates.append((start, actual_ratio))
        if not candidates:
            continue
        by_outcome = {}
        for name, outcome in scenario["outcomes"].items():
            target_ratio = 1 + outcome["total_return"]
            start, actual_ratio = min(
                candidates,
                key=lambda item: abs(math.log(item[1] / target_ratio)),
            )
            analog = monthly.iloc[start:start + months + 1]
            analog_start_close = float(analog["close"].iloc[0])
            adjustment = math.log(target_ratio / actual_ratio)
            projected = []
            for step in range(1, months + 1):
                sample = analog.iloc[step]
                factor = latest_close / analog_start_close * math.exp(adjustment * step / months)
                adjusted = {field: round(float(sample[field]) * factor, 2) for field in fields}
                if step == months:
                    adjusted["close"] = outcome["adjusted_price"]
                adjusted["high"] = max(adjusted["high"], adjusted["open"], adjusted["close"])
                adjusted["low"] = min(adjusted["low"], adjusted["open"], adjusted["close"])
                date = (latest_date + pd.DateOffset(months=step)).date().isoformat()
                projected.append([date, adjusted["open"], adjusted["high"], adjusted["low"], adjusted["close"]])
            by_outcome[name] = {
                "analog_start": str(analog.index[0]),
                "analog_end": str(analog.index[-1]),
                "bars": projected,
            }
        paths[year_key] = by_outcome
    return paths
