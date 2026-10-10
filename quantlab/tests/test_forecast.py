"""Historical scenario calculations and the static market export."""

import json
from pathlib import Path

import pandas as pd
import pytest

from quantlab.forecast import (
    evaluate_historical_scenarios,
    historical_analog_paths,
    historical_scenarios,
)
from scripts.precompute_market import build_market_data


def test_constant_annual_growth_gives_same_three_scenarios(tmp_path):
    dates = pd.date_range("2010-01-31", periods=145, freq="ME")
    closes = pd.Series([100 * 1.1 ** (month / 12) for month in range(len(dates))], index=dates)
    scenarios = historical_scenarios(closes)

    assert set(scenarios) == {str(years) for years in range(1, 12)}
    for years in (1, 5, 10, 11):
        scenario = scenarios[str(years)]
        assert scenario["window_count"] == len(closes) - 12 * years
        for name in ("bearish", "moderate", "bullish"):
            outcome = scenario["outcomes"][name]
            assert outcome["total_return"] == pytest.approx(1.1 ** years - 1, abs=1e-6)
            assert outcome["adjusted_price"] == pytest.approx(
                round(closes.iloc[-1] * 1.1 ** years, 2), abs=.01
            )

    prices = pd.DataFrame({("close", "AAA"): closes}, index=dates)
    prices.columns = pd.MultiIndex.from_tuples(prices.columns)
    payload = build_market_data(prices, tmp_path / "market.json")
    assert payload["symbols"]["AAA"]["historical_scenarios"] == scenarios
    paths = json.loads((tmp_path / "forecast_paths/AAA.json").read_text())
    assert paths["5"]["moderate"]["bars"][-1][4] == scenarios["5"]["outcomes"]["moderate"]["adjusted_price"]


def test_analog_candles_follow_a_past_up_and_down_shape():
    dates = pd.date_range("2010-01-31", periods=145, freq="ME")
    closes = pd.Series([100 * 1.008 ** index * (1.12 if index % 3 == 0 else .92)
                        for index in range(len(dates))], index=dates)
    opens = closes.shift(1).fillna(closes.iloc[0])
    bars = pd.DataFrame({
        "open": opens, "high": pd.concat([opens, closes], axis=1).max(axis=1) * 1.02,
        "low": pd.concat([opens, closes], axis=1).min(axis=1) * .98, "close": closes,
    })
    scenarios = historical_scenarios(closes, horizons=(5,))
    path = historical_analog_paths(bars, scenarios)["5"]["moderate"]
    candles = path["bars"]
    assert len(candles) == 60
    assert candles[-1][0] == scenarios["5"]["through_date"]
    assert candles[-1][4] == scenarios["5"]["outcomes"]["moderate"]["adjusted_price"]
    assert any(close > open_ for _, open_, _, _, close in candles)
    assert any(close < open_ for _, open_, _, _, close in candles)
    assert all(low <= min(open_, close) <= max(open_, close) <= high
               for _, open_, high, low, close in candles)
    bars.loc[dates[0], "high"] = float("inf")
    with pytest.raises(ValueError, match="finite and positive"):
        historical_analog_paths(bars, scenarios)


def test_scenario_holdout_uses_only_prices_available_at_each_origin():
    dates = pd.date_range("2000-01-31", periods=240, freq="ME")
    closes = pd.Series([100 * 1.01 ** month for month in range(len(dates))], index=dates)
    result = evaluate_historical_scenarios(closes, horizons=(1,))["1"]
    assert result["sample_count"] > 10
    assert result["median_error_pp"]["moderate"] == pytest.approx(0, abs=.01)
    assert result["flat_baseline_error_pp"] > 0

    revised = closes.copy()
    revised.loc[revised.index > "2014-12-31"] *= 2
    original_case = next(case for case in result["cases"] if case["origin"] == "2014-12-31")
    revised_case = next(case for case in evaluate_historical_scenarios(
        revised, horizons=(1,)
    )["1"]["cases"] if case["origin"] == "2014-12-31")
    assert revised_case["predicted_returns"] == original_case["predicted_returns"]
    assert revised_case["actual_return"] != original_case["actual_return"]


def test_short_history_omits_unsupported_horizons():
    dates = pd.date_range("2020-01-31", periods=25, freq="ME")
    closes = pd.Series(range(100, 125), index=dates, dtype=float)
    assert set(historical_scenarios(closes)) == {"1"}


def test_missing_month_does_not_create_a_false_one_year_window():
    dates = pd.date_range("2020-01-31", periods=26, freq="ME").delete(12)
    closes = pd.Series(range(100, 125), index=dates, dtype=float)
    scenario = historical_scenarios(closes)["1"]
    assert scenario["window_count"] == 12


@pytest.mark.parametrize("values", [[10, 0, 11], [10, float("nan"), 11], [10, -1, 11]])
def test_rejects_invalid_prices(values):
    dates = pd.date_range("2020-01-31", periods=3, freq="ME")
    with pytest.raises(ValueError, match="finite and positive"):
        historical_scenarios(pd.Series(values, index=dates))


def test_rejects_unsorted_dates_and_invalid_horizon():
    dates = pd.to_datetime(["2020-02-29", "2020-01-31"])
    with pytest.raises(ValueError, match="increasing dates"):
        historical_scenarios(pd.Series([10, 11], index=dates))
    with pytest.raises(ValueError, match="positive whole years"):
        historical_scenarios(pd.Series([10, 11], index=dates[::-1]), horizons=(0,))


def test_market_page_and_snapshot_expose_scenarios_for_all_stocks():
    root = Path(__file__).resolve().parents[2]
    page = (root / "static/markets.html").read_text()
    chart_script = (root / "static/markets.js").read_text()
    snapshot = json.loads((root / "static/data/market.json").read_text())
    assert 'id="forecast-body"' in page
    assert 'id="history-detail-canvas"' in page
    assert 'data-detail-range="4Y" class="active"' in page
    assert 'data-extended-range="4Y" class="active"' in page
    assert "Choose how much past data" in page
    assert "The future line follows" in page
    assert "ghost candles" not in page
    for years in range(1, 5):
        assert f'data-detail-range="{years}Y"' in page
        assert f'data-extended-range="{years}Y"' in page
        assert f'"{years}Y": {12 * years}' in chart_script
    assert "not predictions" in page
    for stock in snapshot["symbols"].values():
        assert "1" in stock["scenario_evaluation"]
        assert {"1", "2", "3", "4", "5", "10"}.issubset(stock["historical_scenarios"])
        assert all(1 <= int(years) <= 20 for years in stock["historical_scenarios"])
        paths = json.loads((root / "static" / stock["forecast_path"]).read_text())
        for years in ("1", "5", "10"):
            for name in ("bearish", "moderate", "bullish"):
                bars = paths[years][name]["bars"]
                assert len(bars) == 12 * int(years)
                assert bars[-1][4] == stock["historical_scenarios"][years]["outcomes"][name]["adjusted_price"]
        assert stock["historical_scenarios"]["10"]["last_window_end"] == stock["last_date"]
