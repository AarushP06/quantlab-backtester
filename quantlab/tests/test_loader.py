"""Offline tests for downloading and caching adjusted market bars."""

import sys
from types import SimpleNamespace

import pandas as pd
import pytest

from quantlab.data import loader

DATES = pd.bdate_range("2024-01-02", periods=3)


def bars(symbols):
    data = {}
    for number, symbol in enumerate(symbols):
        data[("Open", symbol)] = [100 + number, 101 + number, 102 + number]
        data[("Close", symbol)] = [101 + number, 102 + number, 103 + number]
        data[("Volume", symbol)] = [1000, 1100, 1200]
    return pd.DataFrame(data, index=DATES)


def mock_download(monkeypatch, response):
    calls = []

    def download(symbols, **kwargs):
        calls.append((symbols, kwargs))
        return response

    monkeypatch.setitem(sys.modules, "yfinance", SimpleNamespace(download=download))
    return calls


def test_fetch_downloads_adjusted_bars_and_writes_per_symbol_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(loader, "CACHE", tmp_path / "cache")
    calls = mock_download(monkeypatch, bars(["AAA", "BBB"]))

    result = loader.fetch(["AAA", "BBB"], "2024-01-02", "2024-01-05")

    assert calls == [(["AAA", "BBB"], {
        "start": "2024-01-02", "end": "2024-01-05",
        "auto_adjust": True, "progress": False,
    })]
    assert isinstance(result.columns, pd.MultiIndex)
    assert set(result.columns) == {
        ("open", "AAA"), ("close", "AAA"), ("volume", "AAA"),
        ("open", "BBB"), ("close", "BBB"), ("volume", "BBB"),
    }
    assert result.loc[DATES[0], ("close", "BBB")] == 102
    assert {path.name for path in loader.CACHE.iterdir()} == {
        "AAA.parquet", "BBB.parquet"
    }


def test_fetch_uses_partial_cache_and_downloads_only_missing_symbol(monkeypatch, tmp_path):
    monkeypatch.setattr(loader, "CACHE", tmp_path / "cache")
    loader.CACHE.mkdir()
    bars(["AAA"]).xs("AAA", axis=1, level=1).rename(columns=str.lower).to_parquet(
        loader.CACHE / "AAA.parquet"
    )
    calls = mock_download(monkeypatch, bars(["BBB"]))

    result = loader.fetch(["AAA", "BBB"], "2024-01-02", "2024-01-05")

    assert len(calls) == 1
    assert calls[0][0] == ["BBB"]
    assert result.loc[DATES[0], ("close", "AAA")] == 101
    assert result.loc[DATES[0], ("close", "BBB")] == 101

    def unexpected_download(*args, **kwargs):
        raise AssertionError("cache hit must not call yfinance")

    monkeypatch.setitem(sys.modules, "yfinance", SimpleNamespace(download=unexpected_download))
    pd.testing.assert_frame_equal(
        loader.fetch(["AAA", "BBB"], "2024-01-02", "2024-01-05"), result
    )


def test_fetch_refreshes_cache_and_accepts_flat_single_symbol_response(monkeypatch, tmp_path):
    monkeypatch.setattr(loader, "CACHE", tmp_path / "cache")
    loader.CACHE.mkdir()
    bars(["AAA"]).xs("AAA", axis=1, level=1).rename(columns=str.lower).to_parquet(
        loader.CACHE / "AAA.parquet"
    )
    fresh = bars(["AAA"]).xs("AAA", axis=1, level=1).copy()
    fresh["Close"] += 10
    calls = mock_download(monkeypatch, fresh)

    result = loader.fetch(["AAA"], "2024-01-02", "2024-01-05", refresh=True)

    assert calls[0][0] == ["AAA"]
    assert result.loc[DATES[0], ("close", "AAA")] == 111
    assert pd.read_parquet(loader.CACHE / "AAA.parquet").loc[DATES[0], "close"] == 111


def test_fetch_reports_symbol_with_no_data(monkeypatch, tmp_path):
    monkeypatch.setattr(loader, "CACHE", tmp_path / "cache")
    response = bars(["AAA", "MISSING"]).astype(float)
    response.loc[:, pd.IndexSlice[:, "MISSING"]] = float("nan")
    mock_download(monkeypatch, response)

    with pytest.raises(ValueError, match="MISSING"):
        loader.fetch(["AAA", "MISSING"], "2024-01-02", "2024-01-05")

    assert not loader.CACHE.exists()


def test_fetch_reports_empty_download(monkeypatch, tmp_path):
    monkeypatch.setattr(loader, "CACHE", tmp_path / "cache")
    mock_download(monkeypatch, pd.DataFrame())

    with pytest.raises(ValueError, match="AAA.*BBB"):
        loader.fetch(["AAA", "BBB"], "2024-01-02", "2024-01-05")


def test_fetch_keeps_pre_listing_gaps_as_nan(monkeypatch, tmp_path):
    monkeypatch.setattr(loader, "CACHE", tmp_path / "cache")
    response = bars(["AAA", "LATE"]).astype(float)
    response.loc[DATES[0], pd.IndexSlice[:, "LATE"]] = float("nan")
    mock_download(monkeypatch, response)

    result = loader.fetch(["AAA", "LATE"], "2024-01-02", "2024-01-05")

    assert result.index.equals(DATES)
    assert pd.isna(result.loc[DATES[0], ("close", "LATE")])
    assert result.loc[DATES[1], ("close", "LATE")] == 103
    assert pd.read_parquet(loader.CACHE / "LATE.parquet").index.min() == DATES[1]
