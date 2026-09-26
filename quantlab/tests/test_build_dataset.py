"""The dataset builder reports defects and preserves the downloaded frame."""

import pandas as pd

from scripts import build_dataset


def test_build_dataset_reports_issues_and_incomplete_history_without_changes(
    monkeypatch, tmp_path, capsys
):
    monkeypatch.setattr(build_dataset, "SYMBOLS", ["AAA", "BBB"])
    dates = pd.to_datetime(["2020-01-17", "2020-01-21", "2020-01-22"])
    columns = pd.MultiIndex.from_product([["open", "close"], ["AAA", "BBB"]])
    prices = pd.DataFrame(100.0, index=dates, columns=columns)
    prices.loc[dates[1], ("close", "BBB")] = float("nan")
    issue = pd.DataFrame([{
        "date": dates[1], "symbol": "BBB", "issue": "missing close"
    }])
    calls = []

    def fake_fetch(symbols, start, end, refresh):
        calls.append((symbols, start, end, refresh))
        return prices

    monkeypatch.setattr(build_dataset, "fetch", fake_fetch)
    monkeypatch.setattr(build_dataset, "validate", lambda frame: issue)
    output = tmp_path / "processed" / "universe.parquet"

    build_dataset.build_dataset("2020-01-17", "2020-01-23", output)

    assert calls == [(["AAA", "BBB"], "2020-01-17", "2020-01-23", True)]
    pd.testing.assert_frame_equal(pd.read_parquet(output), prices)
    report = capsys.readouterr().out
    assert "missing close" in report
    assert "Symbols: 2" in report
    assert "Date range: 2020-01-17 to 2020-01-22" in report
    assert "Total rows: 3" in report
    assert "BBB: 1" in report
    assert "AAA: 1" not in report
