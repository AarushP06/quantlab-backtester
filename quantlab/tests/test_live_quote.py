"""Selected-symbol quotes never leak a provider key or enter backtests."""

import json
from io import BytesIO
from pathlib import Path

from app import create_app
from app.quotes import MarketQuoteService


def _app_client(tmp_path, service):
    snapshot = tmp_path / "universe.parquet"
    snapshot.write_bytes(b"quote route does not read the backtest data")
    return create_app(snapshot, quote_service=service).test_client()


def test_market_quotes_use_server_key_and_cache_each_symbol(tmp_path):
    calls = []

    def provider(request, timeout):
        calls.append(request)
        assert timeout == 5
        assert request.full_url.endswith(("symbol=GOOGL", "symbol=AAPL"))
        assert request.get_header("X-finnhub-token") == "private-test-key"
        return BytesIO(json.dumps({
            "c": 275.5, "pc": 270.0, "t": 1760000000
        }).encode())

    client = _app_client(
        tmp_path, MarketQuoteService(
            "private-test-key", {"GOOGL", "AAPL"}, opener=provider
        )
    )
    first = client.get("/api/quote/GOOGL")
    second = client.get("/api/quote/GOOGL")
    other = client.get("/api/quote/AAPL")

    assert first.status_code == second.status_code == other.status_code == 200
    assert len(calls) == 2
    assert first.json["price"] == 275.5
    assert first.json["change_percent"] == 2.037037
    assert first.json["symbol"] == "GOOGL"
    assert first.json["source"] == "Finnhub"
    assert other.json["symbol"] == "AAPL"
    assert first.json["quote_time"].endswith("+00:00")
    assert "private-test-key" not in first.get_data(as_text=True)
    assert first.headers["Access-Control-Allow-Origin"] == "*"
    assert first.headers["Cache-Control"] == "public, max-age=30"


def test_quote_without_key_or_price_fails_cleanly(tmp_path):
    missing_key = _app_client(tmp_path, MarketQuoteService(None, {"GOOGL"}))
    response = missing_key.get("/api/quote/GOOGL")
    assert response.status_code == 503
    assert "not configured" in response.json["error"]
    assert response.headers["Cache-Control"] == "no-store"

    def invalid_provider(_request, _timeout):
        return BytesIO(b'{"c":0,"pc":270}')

    invalid = _app_client(
        tmp_path, MarketQuoteService("key", {"GOOGL"}, opener=invalid_provider)
    )
    response = invalid.get("/api/quote/GOOGL")
    assert response.status_code == 503
    assert "temporarily unavailable" in response.json["error"]
    assert invalid.get("/api/quote/UNKNOWN").status_code == 404


def test_market_page_keeps_provider_quotes_separate_from_adjusted_history():
    root = Path(__file__).resolve().parents[2]
    html = (root / "static/markets.html").read_text()
    script = (root / "static/markets.js").read_text()
    assert 'id="provider-quote"' in html
    assert "not included in the historical chart" in html
    assert "/api/quote/" in script
