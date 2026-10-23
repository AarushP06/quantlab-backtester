"""Static navigation between the market chart and forecast explorer."""

from pathlib import Path


def test_forecast_is_a_separate_page_linked_from_markets():
    root = Path(__file__).resolve().parents[2] / "static"
    markets = (root / "markets.html").read_text()
    forecast = (root / "forecast.html").read_text()
    script = (root / "markets.js").read_text()

    assert 'id="open-forecast"' in markets
    assert "forecast.html?symbol=${encodeURIComponent(selectedSymbol)}" in script
    assert 'id="stock-chart"' in forecast
    assert 'id="forecast-years"' in forecast
    assert 'id="forecast-years"' not in markets
    assert 'id="back-to-market"' in forecast


def test_market_picker_is_collapsible_and_scrollable():
    root = Path(__file__).resolve().parents[2] / "static"
    page = (root / "markets.html").read_text()
    script = (root / "markets.js").read_text()
    style = (root / "markets.css").read_text()
    browser_rule = next(line for line in style.splitlines() if line.startswith(".market-browser {"))

    assert 'id="market-picker-toggle"' in page
    assert 'id="market-picker-panel"' in page
    assert 'aria-expanded="false"' in page
    assert 'id="symbol-search"' in page
    assert 'id="symbol-list"' in page
    # Desktop: the browser column scrolls within the viewport. Narrow screens: the stock list scrolls.
    assert "max-height: 100vh" in browser_rule and "overflow-y: auto" in browser_rule
    assert ".stock-list { max-height: 420px; overflow-y: auto; }" in style
    assert 'event.key === "Escape"' in script
