"""Market explorer exports only dated, available adjusted price history."""

import json
from pathlib import Path

import pandas as pd
import pytest

from scripts.precompute_market import build_market_data


def test_market_export_keeps_listing_dates_and_daily_change(tmp_path):
    dates = pd.to_datetime(["2020-01-02", "2020-01-03", "2020-01-06"])
    prices = pd.DataFrame({
        ("close", "AAA"): [10.0, 11.0, 12.0],
        ("close", "BBB"): [float("nan"), 20.0, 18.0],
    }, index=dates)
    prices.columns = pd.MultiIndex.from_tuples(prices.columns)

    output = tmp_path / "market.json"
    payload = build_market_data(prices, output)

    assert json.loads(output.read_text()) == payload
    assert payload["as_of"] == "2020-01-06"
    assert payload["symbols"]["AAA"]["daily_change"] == pytest.approx(12 / 11 - 1, abs=1e-6)
    assert payload["symbols"]["BBB"]["first_date"] == "2020-01-03"
    assert payload["symbols"]["BBB"]["dates"] == ["2020-01-03", "2020-01-06"]
    assert payload["symbols"]["BBB"]["adjusted_close"] == [20.0, 18.0]
    assert payload["symbols"]["BBB"]["daily_change"] == -0.1


def test_market_export_rejects_invalid_close(tmp_path):
    prices = pd.DataFrame({("close", "AAA"): [10.0, 0.0]},
                          index=pd.to_datetime(["2020-01-02", "2020-01-03"]))
    prices.columns = pd.MultiIndex.from_tuples(prices.columns)
    with pytest.raises(ValueError, match="Invalid adjusted close"):
        build_market_data(prices, tmp_path / "market.json")


def test_market_page_and_committed_snapshot_are_present():
    root = Path(__file__).resolve().parents[2]
    page = (root / "static/markets.html").read_text()
    snapshot = json.loads((root / "static/data/market.json").read_text())

    assert 'href="markets.html"' in (root / "static/index.html").read_text()
    assert 'id="symbol-search"' in page
    assert 'id="stock-chart"' in page
    assert "not live quotes" in page
    assert len(snapshot["symbols"]) == 20
    assert snapshot["as_of"] == "2026-09-25"
