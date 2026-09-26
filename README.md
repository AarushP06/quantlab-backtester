# Quantlab backtester

**[Live demo](https://quantlab-backtester.onrender.com)** · backtesting framework with walk-forward validation

Quantlab is a small daily-market-data backtesting framework. It loads adjusted stock prices, walks forward one bar at a time, applies trading costs, and compares each strategy with an equal-weight buy-and-hold baseline. The repository includes a moving-average crossover, a monthly momentum ranking strategy, a parameter sweep, and a one-page Flask viewer.

Backtests can look convincing for the wrong reasons. A strategy that uses a close to decide and trades at that same close has seen information unavailable when the order was placed. Ignoring costs can make frequent trading appear profitable. Choosing assets or parameters after seeing the outcome can make an in-sample result look like a discovery. The framework makes those choices visible; it does not remove all sources of bias.

## Data and execution

The committed [`data/processed/universe.parquet`](data/processed/universe.parquet) contains **1,255 daily rows for 20 US large-cap tickers**, from **2021-09-27 through 2026-09-25**. [`scripts/build_dataset.py`](scripts/build_dataset.py) obtains prices from yfinance with `auto_adjust=True`, so closes account for splits and dividends. The fixed ticker list is in that script. It prints validation issues and saves the combined `(field, symbol)` frame without silently cleaning flagged rows. The saved snapshot was used for the results below; normal app requests read it locally and never download prices.

The engine gives a strategy history through bar *t*. A weight decided on that bar executes at bar *t+1*'s open. Returning `None` means hold the existing share counts without placing an order. `BuyAndHold()` buys equal weights once and then holds those shares. The default cost model charges **5 basis points of traded notional**: 1 bp commission, 2 bps spread, and 2 bps slippage. Reports include both 0 bps and 5 bps.

[`rolling_folds()`](quantlab/core/walkforward.py) reserves rolling training years followed by non-overlapping test years. The fixed crossover is evaluated separately on each test slice. The momentum sweep tries `N ∈ {3, 6, 9, 12}` months and `k ∈ {3, 5, 10}` on each **train** slice, chooses the highest realistic-cost train Sharpe, and runs only that choice on the next test slice. Train prices provide indicator history at the test boundary, but no orders are placed during that context period. The 2026 test fold is only a partial year.

## Measured results

The following table is the output of `to_markdown(evaluate_walkforward(prices, MovingAverageCrossover(20, 50)))` on the committed snapshot. `realistic` means the default 5 bps cost model. The aggregate compounds the independent test-period equity paths; it is not an average of fold returns. CAGR is annualized, including for the partial 2026 fold.

| fold | strategy | cost_model | CAGR | Sharpe | MaxDD | Turnover | Costs | Trades |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| train 2021-2023 / test 2024-2024 | MACross(20/50) | 0 bps | 17.82% | 1.37 | -8.91% | 16.64 | 0.00 | 2847 |
| train 2021-2023 / test 2024-2024 | BuyAndHold (baseline) | 0 bps | 42.40% | 2.59 | -8.41% | 0.82 | 0.00 | 20 |
| train 2022-2024 / test 2025-2025 | MACross(20/50) | 0 bps | 8.50% | 0.60 | -16.25% | 17.48 | 0.00 | 2322 |
| train 2022-2024 / test 2025-2025 | BuyAndHold (baseline) | 0 bps | 16.88% | 1.00 | -17.13% | 0.95 | 0.00 | 20 |
| train 2023-2025 / test 2026-2026 | MACross(20/50) | 0 bps | 0.54% | 0.10 | -6.78% | 21.62 | 0.00 | 1460 |
| train 2023-2025 / test 2026-2026 | BuyAndHold (baseline) | 0 bps | 12.78% | 1.21 | -7.98% | 1.32 | 0.00 | 20 |
| train 2021-2023 / test 2024-2024 | MACross(20/50) | realistic | 16.84% | 1.30 | -8.98% | 16.64 | 887.77 | 2847 |
| train 2021-2023 / test 2024-2024 | BuyAndHold (baseline) | realistic | 42.35% | 2.59 | -8.41% | 0.82 | 50.00 | 20 |
| train 2022-2024 / test 2025-2025 | MACross(20/50) | realistic | 7.54% | 0.55 | -16.40% | 17.48 | 863.56 | 2322 |
| train 2022-2024 / test 2025-2025 | BuyAndHold (baseline) | realistic | 16.83% | 1.00 | -17.14% | 0.95 | 50.00 | 20 |
| train 2023-2025 / test 2026-2026 | MACross(20/50) | realistic | -0.55% | -0.00 | -6.89% | 21.62 | 785.28 | 1460 |
| train 2023-2025 / test 2026-2026 | BuyAndHold (baseline) | realistic | 12.71% | 1.20 | -7.98% | 1.32 | 50.00 | 20 |
| aggregate | MACross(20/50) | 0 bps | 9.58% | 0.76 | -18.62% | 18.41 | 0.00 | 6629 |
| aggregate | BuyAndHold (baseline) | 0 bps | 24.48% | 1.60 | -17.13% | 1.03 | 0.00 | 60 |
| aggregate | MACross(20/50) | realistic | 8.57% | 0.69 | -18.87% | 18.40 | 2,882.91 | 6629 |
| aggregate | BuyAndHold (baseline) | realistic | 24.42% | 1.59 | -17.14% | 1.03 | 204.23 | 60 |

At 5 bps, the crossover's CAGR trails buy-and-hold in **all three** test folds: 16.84% versus 42.35% in 2024, 7.54% versus 16.83% in 2025, and -0.55% versus 12.71% in the partial 2026 fold. Costs lower its results further; the strategy's high turnover matters.

The momentum sweep selected the following parameters using train data only. `Gap` is train Sharpe minus test Sharpe. The baseline column is buy-and-hold **test** Sharpe under the same cost model.

| Test fold | N months | Top k | Costs | Train Sharpe | Test Sharpe | Gap | Baseline test Sharpe |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 2024 | 12 | 10 | 0 bps | 1.423 | 2.335 | -0.912 | 2.588 |
| 2024 | 12 | 10 | 5 bps | 1.410 | 2.324 | -0.914 | 2.585 |
| 2025 | 9 | 5 | 0 bps | 1.838 | 0.252 | 1.586 | 1.001 |
| 2025 | 9 | 5 | 5 bps | 1.829 | 0.237 | 1.592 | 0.998 |
| 2026 partial | 9 | 10 | 0 bps | 1.425 | 0.941 | 0.484 | 1.207 |
| 2026 partial | 9 | 10 | 5 bps | 1.416 | 0.925 | 0.491 | 1.201 |

**Average train-minus-test gap:** 0.386 Sharpe points at 0 bps and 0.390 at 5 bps. Test Sharpe was lower than train in two folds, but **higher** in 2024. The selected momentum strategy trailed buy-and-hold test Sharpe in all three folds under both cost assumptions. Those results do not establish that every future fold will underperform, or that the observed average gap is stable.

## Limitations

- **Survivorship and selection bias:** the universe is a present-day choice of 20 large-cap names, not the companies that would have belonged to a top-20 universe at each past date. Selecting today's large, surviving companies can select for past success. The code does not verify that these tickers are literally the current top 20 by market capitalization.
- **Small sample:** there are only three test folds, with overlapping training windows and a partial 2026 test year. That is too little independent evidence for a reliable estimate of future performance.
- **Narrow market exposure:** the sample covers one asset class, US large-cap equities, and one 2021–2026 span dominated by a strong equity advance. It includes a 2022 decline but does not test many distinct market regimes.
- **Data quality:** the saved validation run flagged 2025-01-09 as absent across the universe and a 26.4% META move on 2022-02-03. Those flags were not silently repaired; they need investigation before stronger claims.
- **Live trading differs:** fills may slip beyond the modeled 5 bps, spreads and impact change with liquidity, orders can be delayed or rejected, and taxes, funding, operational failures, and data revisions are not captured. Backtest timing and adjusted historical prices cannot guarantee executable live returns.

These runs support a narrow finding: **neither tested strategy beat the buy-and-hold baseline on its reported out-of-sample comparison**. They do not establish a general ranking of strategies.

## Setup and run

Use Python 3.9 or newer from the repository root. The processed Parquet snapshot is committed, so the commands below do not need a market-data download.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m pytest -q
python scripts/run_backtest.py
python scripts/param_sweep.py
python -m flask --app app.wsgi:app run
```

Open `http://127.0.0.1:5000/` for the form. The app reads the committed Parquet file; it raises a clear startup error if the file is missing. To regenerate the snapshot deliberately, run `python scripts/build_dataset.py` with network access, inspect its printed validation issues, and review the changed Parquet file before committing it.

For a local container, run `docker build -t quantlab .` and `docker run --rm -p 10000:10000 quantlab`. The [Render Blueprint](render.yaml) uses the same Dockerfile. The image copies the committed snapshot and does not call yfinance during its build or while handling requests.
