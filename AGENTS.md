# Quantlab backtesting framework

## Required rules

- Strategies receive only history up to and including the current bar t. Signals decided on bar t execute at bar t+1's open. Deciding and executing on the same bar is a bug. Never bypass history slicing by loading or retaining future data inside a strategy.
- Report every strategy result against a buy-and-hold baseline over the same data and evaluation period, with matching cost assumptions.
- Always apply the transaction-cost model to trades. Report both an explicit 0 bps run and a realistic-cost run for the strategy and baseline. The current default is 5 bps total: 1 bps commission, 2 bps spread, and 2 bps slippage.
- Keep logic in Python modules. Notebooks only import and plot; do not implement strategy, data, backtesting, or metric logic in notebooks.
- Every new feature must ship with pytest tests in `quantlab/tests/`. Preserve tests for history slicing, next-bar execution, costs, and input validation.

## Source overview

- `engine.py`: bar-by-bar execution, transaction costs, positions, trades, and equity.
- `strategy.py`: abstract strategy interface returning target portfolio weights.
- `buy_hold.py` and `ma_crossover.py`: baseline and moving-average example strategies.
- `loader.py`: data validation and an unimplemented fetch/cache entry point.
- `metrics.py`: performance metrics and baseline comparison tables.
- `walkforward.py`: rolling calendar-year train/test folds.
- `test_no_lookahead.py`: six tests covering timing, data visibility, costs, deliberate future-data leakage, and validation.
- `requirements.txt`: Python dependencies.

## Checkout layout and validation

The supplied checkout currently stores these files flat under `files/`; it does not contain the expected `quantlab/` package or `quantlab/tests/` directory. Tests import `quantlab.core` and `quantlab.strategies`, and source modules use relative package imports. Do not mistake the flat supplied layout for an installed, runnable package.

Run `python3 -m pytest` from this project directory. When the intended package layout is present, new tests belong in `quantlab/tests/`. Report actual test outcomes; do not claim passing tests when collection or dependency loading fails.
