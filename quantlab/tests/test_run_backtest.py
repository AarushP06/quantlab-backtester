"""The backtest runner prints both cost scenarios against the baseline."""

import pandas as pd

from scripts.run_backtest import run_backtests


def test_run_backtests_prints_strategy_and_baseline_for_both_costs(tmp_path, capsys):
    dates = pd.bdate_range("2024-01-02", periods=60)
    prices = pd.DataFrame(
        {("open", "AAA"): range(100, 160), ("close", "AAA"): range(100, 160)},
        index=dates,
    )
    prices.columns = pd.MultiIndex.from_tuples(prices.columns)
    path = tmp_path / "universe.parquet"
    prices.to_parquet(path)

    tables = run_backtests(path)

    assert set(tables) == {"0 bps", "Default costs (5 bps)"}
    for table in tables.values():
        assert list(table.columns) == ["MACross(20/50)", "BuyAndHold (baseline)"]
    assert tables["0 bps"].loc["Costs paid"].eq(0).all()
    assert tables["Default costs (5 bps)"].loc["Costs paid"].gt(0).all()
    output = capsys.readouterr().out
    assert "0 bps" in output
    assert "Default costs (5 bps)" in output
