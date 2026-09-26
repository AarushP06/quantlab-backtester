"""Missing bars are defined by exchange sessions, not weekdays."""

import pandas as pd

from quantlab.data.loader import validate


def prices_for(dates):
    columns = pd.MultiIndex.from_tuples([("close", "AAA")])
    return pd.DataFrame([100.0] * len(dates), index=pd.to_datetime(dates), columns=columns)


def test_nyse_holiday_is_not_a_missing_bar():
    prices = prices_for(["2020-01-17", "2020-01-21"])

    issues = validate(prices)

    assert issues.empty


def test_dropped_nyse_session_is_a_missing_bar():
    prices = prices_for(["2020-01-17", "2020-01-22"])

    issues = validate(prices)

    missing = issues[issues["issue"] == "missing bar"]
    assert missing.to_dict("records") == [{
        "date": pd.Timestamp("2020-01-21"), "symbol": "*", "issue": "missing bar"
    }]
