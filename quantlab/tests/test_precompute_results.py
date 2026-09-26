"""Static exports contain every strategy, cost, fold, and chart series."""

import json

import pandas as pd

from scripts.precompute_results import STRATEGIES, build_results


def test_precompute_exports_all_scenarios_without_network(tmp_path):
    dates = pd.DatetimeIndex(
        date for year in range(2020, 2024)
        for date in pd.bdate_range(f"{year}-01-02", periods=60)
    )
    count = len(dates)
    first = pd.Series(range(100, 100 + count), index=dates, dtype=float)
    second = pd.Series(range(50, 50 + count), index=dates, dtype=float)
    second.loc[second.index.year < 2022] = float("nan")
    prices = pd.DataFrame(
        {
            ("open", "AAA"): first,
            ("close", "AAA"): first,
            ("open", "BBB"): second,
            ("close", "BBB"): second,
        },
        index=dates,
    )
    prices.columns = pd.MultiIndex.from_tuples(prices.columns)

    output = tmp_path / "static/data"
    manifest = build_results(prices, output)

    assert len(manifest["strategies"]) == len(STRATEGIES) == 6
    assert [period["id"] for period in manifest["periods"]] == ["full", "2023"]
    assert len(list(output.glob("*.json"))) == 13  # six strategies × two costs + manifest
    assert json.loads((output / "manifest.json").read_text()) == manifest

    for strategy in manifest["strategies"]:
        for cost in ("0", "5"):
            path = output / strategy["files"][cost].removeprefix("data/")
            payload = json.loads(path.read_text(), parse_constant=lambda value: 1 / 0)
            assert set(payload["periods"]) == {"full", "2023"}
            assert len(payload["periods"]["full"]["equity"]) == count
            assert len(payload["periods"]["2023"]["equity"]) == 60
            assert len(payload["periods"]["2023"]["dates"]) == 60
            assert payload["periods"]["full"]["metrics"]["trades"] >= 0
            if cost == "0":
                assert payload["periods"]["full"]["metrics"]["costs_paid"] == 0

    never = json.loads((output / "buy_hold_never_5.json").read_text())
    listing = json.loads((output / "buy_hold_on_listing_5.json").read_text())
    assert listing["periods"]["full"]["metrics"]["trades"] > never["periods"]["full"]["metrics"]["trades"]


def test_static_entrypoint_uses_json_and_vercel_serves_static_directory():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    html = (root / "static/index.html").read_text()
    config = json.loads((root / "vercel.json").read_text())

    assert 'fetch(path)' in html
    assert 'loadJson("data/manifest.json")' in html
    assert "cdn.jsdelivr.net/npm/chart.js" in html
    assert config["outputDirectory"] == "static"


def test_committed_static_data_covers_full_period_and_19_folds():
    from pathlib import Path

    data = Path(__file__).resolve().parents[2] / "static/data"
    manifest = json.loads((data / "manifest.json").read_text())

    assert manifest["bars"] == 5467
    assert manifest["symbols"] == 20
    assert len(manifest["periods"]) == 20
    assert [period["id"] for period in manifest["periods"]][1:] == [
        str(year) for year in range(2008, 2027)
    ]
    assert len(manifest["strategies"]) == 6
    for strategy in manifest["strategies"]:
        for cost in ("0", "5"):
            filename = strategy["files"][cost].removeprefix("data/")
            payload = json.loads((data / filename).read_text())
            assert set(payload["periods"]) == {
                period["id"] for period in manifest["periods"]
            }
            for period in payload["periods"].values():
                assert len(period["dates"]) == len(period["equity"])
                assert len(period["dates"]) >= 2
