"""Static exports contain every strategy, cost, fold, and chart series."""

import json

import pandas as pd

from scripts.precompute_results import STRATEGIES, build_results, rolling_windows


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
    assert len(list(output.glob("*.json"))) == 26
    assert json.loads((output / "manifest.json").read_text()) == manifest
    assert len(manifest["windows"]) == 6  # four 1-year and two 3-year windows
    assert {window["id"] for window in manifest["windows"]} == {
        "2020_1", "2021_1", "2022_1", "2023_1", "2020_3", "2021_3",
    }
    shared_dates = json.loads((output / "windows.json").read_text())["dates"]
    assert len(shared_dates["2020_3"]) == 180
    assert shared_dates["2020_3"][-1].startswith("2022-")

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
            simulator_path = output / strategy["simulator_files"][cost].removeprefix("data/")
            simulator = json.loads(simulator_path.read_text())
            assert set(simulator["windows"]) == set(shared_dates)
            for key, window in simulator["windows"].items():
                assert len(window["equity_per_dollar"]) == len(shared_dates[key])
                assert window["equity_per_dollar"][-1] == window["final_per_dollar"]
                assert abs(window["final_per_dollar"] - 1 - window["metrics"]["total_return"]) < 1e-8

    never = json.loads((output / "buy_hold_never_5.json").read_text())
    listing = json.loads((output / "buy_hold_on_listing_5.json").read_text())
    assert listing["periods"]["full"]["metrics"]["trades"] > never["periods"]["full"]["metrics"]["trades"]


def test_rolling_windows_include_only_fitting_calendar_pairs():
    dates = pd.DatetimeIndex(pd.Timestamp(year, 1, 2) for year in range(2005, 2027))
    frame = pd.DataFrame(index=dates)
    windows, slices = rolling_windows(frame)

    assert len(windows) == 76
    assert "2005_20" in slices
    assert "2007_20" in slices
    assert "2008_20" not in slices
    assert "2026_1" in slices
    assert all(window["end_year"] <= 2026 for window in windows)


def test_static_entrypoint_uses_json_and_vercel_serves_static_directory():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    html = (root / "static/index.html").read_text()
    script = (root / "static/app.js").read_text()
    styles = (root / "static/styles.css").read_text()
    config = json.loads((root / "vercel.json").read_text())

    assert "Historical simulation" in html
    assert "Past performance does not predict future returns" in html
    assert "20 large caps selected today" in html
    assert 'id="sim-amount"' in html
    assert 'id="sim-start"' in html
    assert 'id="sim-horizon"' in html
    assert 'id="sim-baseline-final"' in html
    assert "fetch(path)" in script
    assert 'loadJson("data/manifest.json")' in script
    assert "baseline.equity_per_dollar" in script
    assert "prefers-color-scheme: dark" in styles
    assert ".notice { position: sticky" in styles
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
    assert len(manifest["windows"]) == 76
    shared_dates = json.loads((data / "windows.json").read_text())["dates"]
    assert len(shared_dates) == 76
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
            simulator_file = strategy["simulator_files"][cost].removeprefix("data/")
            simulator = json.loads((data / simulator_file).read_text())["windows"]
            assert set(simulator) == set(shared_dates)
            assert simulator["2008_1"]["metrics"]["cagr"] == (
                payload["periods"]["2008"]["metrics"]["cagr"]
            )
            for key, window in simulator.items():
                assert len(window["equity_per_dollar"]) == len(shared_dates[key])
                assert window["equity_per_dollar"][-1] == window["final_per_dollar"]


def test_lab_verdict_uses_existing_test_folds_and_has_clickable_years():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    html = (root / "static/index.html").read_text()
    script = (root / "static/app.js").read_text()
    data = root / "static/data"
    manifest = json.loads((data / "manifest.json").read_text())
    strategy = json.loads((data / "ma_20_50_5.json").read_text())["periods"]
    baseline = json.loads((data / "buy_hold_never_5.json").read_text())["periods"]
    years = [period["id"] for period in manifest["periods"] if period["id"] != "full"]
    gaps = [strategy[year]["metrics"]["cagr"] - baseline[year]["metrics"]["cagr"]
            for year in years]

    assert len(years) == 19
    assert sum(gap > 0 for gap in gaps) == 4
    assert sum(gaps) / len(gaps) < 0
    assert 'id="verdict-line"' in html
    assert 'id="verdict-wins"' in html
    assert 'id="fold-chart"' in html
    assert 'id="sim-difference"' in html
    assert 'id="baseline-help"' in html
    assert "renderVerdict(strategyPeriods, baselinePeriods" in script
    assert "selectPeriod(folds[elements[0].index].id" in script
