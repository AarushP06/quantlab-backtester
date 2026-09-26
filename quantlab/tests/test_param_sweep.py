"""Parameter selection is confined to each fold's training frame."""

from types import SimpleNamespace

import pandas as pd

from scripts import param_sweep


def test_selection_checks_full_grid_using_train_only(monkeypatch):
    train = pd.DataFrame({"close": [1, 2]})
    seen = []

    class Engine:
        def __init__(self, prices, costs):
            assert prices is train

        def run(self, strategy):
            seen.append((strategy.months, strategy.k))
            return SimpleNamespace(returns=pd.Series([strategy.months + strategy.k / 100]))

    monkeypatch.setattr(param_sweep, "BacktestEngine", Engine)
    monkeypatch.setattr(param_sweep, "sharpe", lambda returns: returns.iloc[0])

    months, k, score = param_sweep.select_on_train(train, param_sweep.CostModel())

    assert seen == [(n, top_k) for n in (3, 6, 9, 12) for top_k in (3, 5, 10)]
    assert (months, k, score) == (12, 10, 12.1)


def test_test_period_runs_only_train_selected_pair(monkeypatch):
    train = pd.DataFrame(index=pd.to_datetime(["2022-01-03", "2022-01-04"]))
    test = pd.DataFrame(index=pd.to_datetime(["2023-01-03", "2023-01-04"]))
    fold = SimpleNamespace(train=train, test=test, label="fold 1")
    events = []

    def select(train_frame, costs):
        assert train_frame is train
        events.append("select")
        return 6, 5, 1.5

    def test_sharpe(train_frame, test_frame, strategy, costs, use_train_history):
        assert train_frame is train and test_frame is test
        assert events[0] == "select"
        if isinstance(strategy, param_sweep.MomentumRanking):
            assert (strategy.months, strategy.k) == (6, 5)
        events.append("test")
        return 0.5

    class Engine:
        def __init__(self, prices, costs):
            assert prices is train

        def run(self, strategy):
            return SimpleNamespace(returns=pd.Series([0.1, 0.2]))

    monkeypatch.setattr(param_sweep, "rolling_folds", lambda *args: [fold])
    monkeypatch.setattr(param_sweep, "select_on_train", select)
    monkeypatch.setattr(param_sweep, "_test_sharpe", test_sharpe)
    monkeypatch.setattr(param_sweep, "BacktestEngine", Engine)
    monkeypatch.setattr(param_sweep, "sharpe", lambda returns: 1.5)

    report = param_sweep.run_sweep(pd.DataFrame())

    assert events == ["select", "test", "test", "test", "test"]
    assert set(zip(report["N"], report["k"])) == {(6, 5)}
    assert (report["gap"] == 1.0).all()
