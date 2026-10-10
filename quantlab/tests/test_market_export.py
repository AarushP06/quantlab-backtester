"""Market explorer exports only dated, available adjusted price history."""

import json
from pathlib import Path

import pandas as pd
import pytest

from scripts.build_market_extras import build_market_extras
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


def test_extra_market_history_is_saved_separately_without_network(tmp_path, monkeypatch):
    dates = pd.to_datetime(["2020-01-02", "2020-01-03"])
    universe = pd.DataFrame({("close", "AAA"): [10.0, 11.0]}, index=dates)
    universe.columns = pd.MultiIndex.from_tuples(universe.columns, names=["field", "symbol"])
    dataset = tmp_path / "universe.parquet"
    output = tmp_path / "market_extras.parquet"
    universe.to_parquet(dataset)
    extra = pd.DataFrame({("close", "BBB"): [20.0, 21.0]}, index=dates)
    extra.columns = pd.MultiIndex.from_tuples(extra.columns, names=["field", "symbol"])
    calls = []

    def fake_fetch(symbols, start, end):
        calls.append((symbols, start, end))
        return extra

    monkeypatch.setattr("scripts.build_market_extras.fetch", fake_fetch)
    monkeypatch.setattr("scripts.build_market_extras.validate", lambda prices: pd.DataFrame())
    build_market_extras(["BBB"], dataset, output)

    assert calls == [(["BBB"], "2020-01-02", "2020-01-04")]
    pd.testing.assert_frame_equal(pd.read_parquet(dataset), universe)
    pd.testing.assert_frame_equal(pd.read_parquet(output), extra)


def test_market_page_and_committed_snapshot_are_present():
    root = Path(__file__).resolve().parents[2]
    page = (root / "static/markets.html").read_text()
    snapshot = json.loads((root / "static/data/market.json").read_text())

    assert 'href="markets.html"' in (root / "static/index.html").read_text()
    assert 'id="symbol-search"' in page
    assert 'id="stock-chart"' in page
    assert "Stock history and backtests use a saved snapshot" in page
    assert "Minute charts and provider quotes appear separately" in page
    assert len(snapshot["symbols"]) == 30
    assert {"AMD", "ADBE", "CRM", "NFLX", "ORCL", "BAC", "KO", "PEP", "DIS", "MCD"}.issubset(snapshot["symbols"])
    universe = pd.read_parquet(root / "data/processed/universe.parquet")
    assert snapshot["as_of"] == universe.index.max().date().isoformat()
    assert all(stock["last_date"] == snapshot["as_of"] for stock in snapshot["symbols"].values())


def test_other_markets_are_labeled_chart_only_and_outside_stock_snapshot():
    root = Path(__file__).resolve().parents[2]
    page = (root / "static/markets.html").read_text()
    script = (root / "static/markets.js").read_text()
    snapshot = json.loads((root / "static/data/market.json").read_text())

    assert 'id="asset-chart"' in page
    assert 'class="asset-workspace"' in page
    assert 'class="asset-sidebar"' in page
    assert 'id="stock-main"' in page
    assert page.count('class="surface asset-panel"') == 1
    assert 'class="market-layout"' not in page
    # Stocks, gold, and Bitcoin share one searchable list instead of separate categories.
    assert page.count('id="symbol-list"') == 1
    assert page.index('id="symbol-list"') < page.index('id="asset-chart"')
    for removed in ('id="asset-list"', 'id="assets-toggle"', 'id="stocks-toggle"', 'id="stock-picker"'):
        assert removed not in page
    assert "Gold and Bitcoin are chart-only here" in page
    assert "Data may be delayed" in page
    for symbol in ("OANDA:XAUUSD", "BITSTAMP:BTCUSD"):
        assert symbol in script
    for symbol in ("CME_MINI:MNQ1!", "CME_MINI:NQ1!"):
        assert symbol not in script
    assert "SP:SPX" not in script
    assert "NYMEX:CL1!" not in script
    assert not {"MNQ", "NQ", "GOLD", "BTC"}.intersection(snapshot["symbols"])
