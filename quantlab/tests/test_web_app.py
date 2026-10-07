"""The web page backtests only the cached price frame."""

import base64
import re

import pandas as pd
import pytest

from app import create_app


def cached_prices(tmp_path):
    dates = pd.bdate_range("2024-01-02", periods=90)
    frame = pd.DataFrame(
        {
            ("open", "AAA"): range(100, 190),
            ("close", "AAA"): range(100, 190),
            ("open", "BBB"): range(200, 290),
            ("close", "BBB"): range(200, 290),
        },
        index=dates,
    )
    frame.columns = pd.MultiIndex.from_tuples(frame.columns)
    path = tmp_path / "universe.parquet"
    frame.to_parquet(path)
    return path, dates


def test_page_renders_cached_strategy_vs_baseline_with_both_costs(tmp_path, monkeypatch):
    path, dates = cached_prices(tmp_path)

    def no_download(*args, **kwargs):
        raise AssertionError("a web request must not download market data")

    monkeypatch.setattr("quantlab.data.loader.fetch", no_download)
    client = create_app(path).test_client()

    assert client.get("/").status_code == 200
    response = client.get("/", query_string={
        "strategy": "ma", "start": dates[0].date().isoformat(),
        "end": dates[-1].date().isoformat(), "cost": "5",
    })

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "Equity curve · 5 bps" in html
    assert "MACross(20/50)" in html
    assert "BuyAndHold (baseline)" in html
    assert html.count("<tr><td>") == 4
    encoded = re.search(r"data:image/png;base64,([A-Za-z0-9+/=]+)", html).group(1)
    assert base64.b64decode(encoded).startswith(b"\x89PNG\r\n\x1a\n")


def test_page_validates_inputs_and_reports_missing_cache(tmp_path):
    path, dates = cached_prices(tmp_path)
    client = create_app(path).test_client()
    response = client.get("/", query_string={
        "strategy": "ma", "start": dates[-1].date().isoformat(),
        "end": dates[0].date().isoformat(), "cost": "0",
    })
    assert response.status_code == 400
    assert "Choose a date range" in response.get_data(as_text=True)

    with pytest.raises(FileNotFoundError, match="Processed dataset missing.*universe.parquet"):
        create_app(tmp_path / "absent" / "universe.parquet")


def test_render_app_serves_market_explorer_and_saved_data(tmp_path):
    path, _dates = cached_prices(tmp_path)
    client = create_app(path).test_client()

    page = client.get("/markets.html?symbol=GOOGL")
    assert page.status_code == 200
    assert b'id="provider-quote"' in page.data
    assert b"/markets.html" in client.get("/").data
    assert client.get("/markets.js").status_code == 200
    snapshot = client.get("/data/market.json")
    assert snapshot.status_code == 200
    assert "GOOGL" in snapshot.json["symbols"]
