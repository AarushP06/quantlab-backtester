"""Validation and staged publication for the stock snapshot refresh."""

from datetime import date

import pandas as pd
import pytest

from scripts import refresh_snapshot as refresh


def sample_prices() -> pd.DataFrame:
    dates = pd.date_range("2026-09-21", "2026-09-25", freq="B")
    prices = pd.DataFrame({
        ("open", "AAA"): [100, 101, 102, 103, 104],
        ("close", "AAA"): [101, 102, 103, 104, 105],
        ("open", "BBB"): [200, 201, 202, 203, 204],
        ("close", "BBB"): [201, 202, 203, 204, 205],
    }, index=dates)
    prices.columns = pd.MultiIndex.from_tuples(prices.columns, names=["field", "symbol"])
    return prices.sort_index(axis=1)


def test_refresh_validation_rejects_missing_symbol_session():
    prices = sample_prices()
    assert refresh.validate_snapshot(prices, ["AAA", "BBB"], date(2026, 9, 25)) == "2026-09-25"
    prices.loc[pd.Timestamp("2026-09-23"), ("close", "BBB")] = float("nan")
    with pytest.raises(ValueError, match="Missing stock sessions"):
        refresh.validate_snapshot(prices, ["AAA", "BBB"], date(2026, 9, 25))


def test_refresh_requires_review_only_for_new_large_move_flags():
    prices = sample_prices()
    prices.loc[pd.Timestamp("2026-09-24"), ("close", "AAA")] = 150
    with pytest.raises(ValueError, match="new validation flags"):
        refresh.validate_snapshot(prices, ["AAA", "BBB"], date(2026, 9, 25))
    known = refresh.quality_flags(prices)
    assert known
    assert refresh.validate_snapshot(
        prices, ["AAA", "BBB"], date(2026, 9, 25), known_flags=known
    ) == "2026-09-25"


def test_documented_2025_exchange_closure_is_not_a_missing_bar():
    dates = pd.to_datetime(["2025-01-08", "2025-01-10"])
    prices = pd.DataFrame({("close", "AAA"): [100, 101]}, index=dates)
    prices.columns = pd.MultiIndex.from_tuples(prices.columns, names=["field", "symbol"])
    assert refresh.validate_snapshot(prices, ["AAA"], date(2025, 1, 10)) == "2025-01-10"


def test_refresh_stages_exports_before_publishing(tmp_path, monkeypatch):
    prices = sample_prices()
    monkeypatch.setattr(refresh, "BACKTEST_SYMBOLS", ["AAA"])
    monkeypatch.setattr(refresh, "EXTRA_SYMBOLS", ["BBB"])
    monkeypatch.setattr(refresh, "fetch", lambda *_args, **_kwargs: prices)

    def write_results(_prices, output):
        output.mkdir(parents=True)
        (output / "manifest.json").write_text("ready")

    def write_market(_prices, output, source):
        output.write_text(source)
        return {"as_of": "2026-09-25"}

    monkeypatch.setattr(refresh, "build_results", write_results)
    monkeypatch.setattr(refresh, "build_market_data", write_market)
    as_of = refresh.refresh_snapshot(date(2026, 9, 21), date(2026, 9, 25), tmp_path)
    assert as_of == "2026-09-25"
    assert (tmp_path / "static/data/manifest.json").read_text() == "ready"
    assert (tmp_path / "static/data/market.json").is_file()
    assert (tmp_path / "data/processed/universe.parquet").is_file()
    assert (tmp_path / "data/processed/market_extras.parquet").is_file()

    (tmp_path / "static/data/market.json").write_text("original")
    monkeypatch.setattr(refresh, "build_results", lambda *_args: (_ for _ in ()).throw(ValueError("build failed")))
    with pytest.raises(ValueError, match="build failed"):
        refresh.refresh_snapshot(date(2026, 9, 21), date(2026, 9, 25), tmp_path)
    assert (tmp_path / "static/data/market.json").read_text() == "original"
