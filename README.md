# Quantlab backtester

**[Live demo](https://quantlab-backtester.onrender.com)** · backtesting framework with walk-forward validation

Quantlab is a small daily-market-data backtesting framework. It loads adjusted stock prices, walks forward one bar at a time, applies trading costs, and compares each strategy with an equal-weight buy-and-hold baseline. The repository includes a moving-average crossover, a monthly momentum ranking strategy, a parameter sweep, and a one-page Flask viewer.

Backtests can look convincing for the wrong reasons. A strategy that uses a close to decide and trades at that same close has seen information unavailable when the order was placed. Ignoring costs can make frequent trading appear profitable. Choosing assets or parameters after seeing the outcome can make an in-sample result look like a discovery. The framework makes those choices visible; it does not remove all sources of bias.

## Data and execution

The committed [`data/processed/universe.parquet`](data/processed/universe.parquet) contains **5,467 daily rows for 20 US large-cap tickers**, from **2005-01-03 through 2026-09-25**. [`scripts/build_dataset.py`](scripts/build_dataset.py) downloads yfinance prices with `auto_adjust=True` and keeps the raw adjusted bars in `(field, symbol)` columns. Its CLI defaults to `--start 2005-01-01` and an inclusive `--end` of today. Regeneration requires network access; app requests use only the committed Parquet file.

Symbols that listed later remain `NaN` before their first bar. They are not backfilled or dropped. The actual first available dates in this snapshot are:

| Symbol | First available date |
| --- | --- |
| AAPL | 2005-01-03 |
| ABBV | 2013-01-02 |
| AMZN | 2005-01-03 |
| AVGO | 2009-08-06 |
| BRK-B | 2005-01-03 |
| COST | 2005-01-03 |
| GOOGL | 2005-01-03 |
| HD | 2005-01-03 |
| JNJ | 2005-01-03 |
| JPM | 2005-01-03 |
| MA | 2006-05-25 |
| META | 2012-05-18 |
| MSFT | 2005-01-03 |
| NVDA | 2005-01-03 |
| PG | 2005-01-03 |
| TSLA | 2010-06-29 |
| UNH | 2005-01-03 |
| V | 2008-03-19 |
| WMT | 2005-01-03 |
| XOM | 2005-01-03 |

The engine gives a strategy history through bar *t*. Weights decided on that bar execute at bar *t+1*'s open; `None` means leave current shares untouched. A symbol with no open price cannot trade. A held symbol with a missing quote is marked at its last observed price until a new quote arrives, rather than at zero.

**Baseline membership is a choice.** `BuyAndHold(rebalance="never")`, the default and the baseline used in every results table below, submits equal target weights across the full 20-symbol universe once, then holds the filled share counts forever. In the 2005-start run, only **14 symbols** have prices at entry; the other six cannot be bought, and their target allocation remains cash. `BuyAndHold(rebalance="on_listing")` instead starts equal-weighted across those 14 available symbols. When a later-listed symbol first has a closing price, it submits new equal weights across all symbols seen so far; trades execute at the following bar's open. It then holds shares unchanged until another first listing. This brings later listings into the portfolio but also sells and buys existing holdings, changing exposure, turnover, and costs. Neither mode backfills pre-listing prices. Choose the baseline explicitly when comparing strategies; the reported `never` results must not be read as `on_listing` results.

The default cost model charges **5 basis points of traded notional**: 1 bp commission, 2 bps spread, and 2 bps slippage. Reports also show 0 bps. [`rolling_folds()`](quantlab/core/walkforward.py) uses three training years followed by non-overlapping one-year test periods. The fixed moving-average crossover is run on each test slice. The momentum sweep tries `N ∈ {3, 6, 9, 12}` months and `k ∈ {3, 5, 10}` on each train slice, selects the best realistic-cost train Sharpe, and evaluates only that pair on the following test slice. The 2026 fold is partial.

### Validation flags

The builder retained all prices and used the unchanged **25% close-to-close move threshold**. Its latest `validate()` run returned these flags:

| Date | Symbol | Flag |
| --- | --- | --- |
| 2025-01-09 | * | missing bar |
| 2007-04-25 | AMZN | move 26.9% - check for a split |
| 2009-10-23 | AMZN | move 26.8% - check for a split |
| 2009-01-21 | JPM | move 25.1% - check for a split |
| 2013-07-25 | META | move 29.6% - check for a split |
| 2022-02-03 | META | move 26.4% - check for a split |
| 2008-07-03 | NVDA | move 30.7% - check for a split |
| 2016-11-11 | NVDA | move 29.8% - check for a split |
| 2008-10-13 | UNH | move 34.8% - check for a split |

These are review flags, not automatic corrections. The current XNYS calendar flags 2025-01-09 as a missing session across the universe. The selected symbols did **not** have a 2020 daily close-to-close move above 25%; the largest absolute 2020 move was **21.1% for TSLA on 2020-09-08**. The 2020 crash is present in the data, but this threshold does not flag it. Lowering the threshold or suppressing flags to fit an expectation would change the validation rule.

## Measured results

All figures below use this 2005–2026 snapshot and the code in this repository. The full-period 20/50 crossover trails both baseline definitions. These full-period results include a present-day selected universe and are not an independent test.

| Cost | Measure | MACross(20/50) | BuyAndHold `never` | BuyAndHold `on_listing` |
| --- | --- | ---: | ---: | ---: |
| 0 bps | Total return | 4,312.29% | 9,525.25% | 20,052.70% |
| 0 bps | CAGR | 19.07% | 23.43% | 27.71% |
| 0 bps | Sharpe | 1.001 | 1.035 | 1.053 |
| 5 bps | Total return | 3,382.84% | 9,525.22% | 20,032.72% |
| 5 bps | CAGR | 17.78% | 23.43% | 27.70% |
| 5 bps | Sharpe | 0.944 | 1.035 | 1.052 |

The `on_listing` full-period baseline starts fully invested in the available names and enters the other six as they arrive. The difference from `never` is therefore substantial; it is a different portfolio policy, not a free improvement to the same benchmark.

The following is `to_markdown()` output for all **19 realistic-cost test folds** and the compounded aggregate. The full function also returns 0 bps rows. The aggregate compounds independent test-period equity paths; it is not the mean fold return.

| fold | strategy | cost_model | CAGR | Sharpe | MaxDD | Turnover | Costs | Trades |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| train 2005-2007 / test 2008-2008 | MACross(20/50) | realistic | -12.55% | -0.27 | -30.73% | 27.68 | 1,408.32 | 1198 |
| train 2005-2007 / test 2008-2008 | BuyAndHold (baseline) | realistic | -22.95% | -0.87 | -31.23% | 0.84 | 37.50 | 15 |
| train 2006-2008 / test 2009-2009 | MACross(20/50) | realistic | 50.21% | 2.19 | -8.41% | 12.80 | 773.08 | 2519 |
| train 2006-2008 / test 2009-2009 | BuyAndHold (baseline) | realistic | 37.27% | 1.61 | -16.21% | 0.72 | 40.00 | 16 |
| train 2007-2009 / test 2010-2010 | MACross(20/50) | realistic | 2.09% | 0.21 | -21.25% | 21.74 | 1,032.35 | 2149 |
| train 2007-2009 / test 2010-2010 | BuyAndHold (baseline) | realistic | 8.82% | 0.67 | -13.49% | 0.85 | 42.50 | 17 |
| train 2008-2010 / test 2011-2011 | MACross(20/50) | realistic | 5.43% | 0.35 | -17.88% | 23.34 | 1,193.97 | 2090 |
| train 2008-2010 / test 2011-2011 | BuyAndHold (baseline) | realistic | 11.10% | 0.61 | -13.21% | 0.85 | 45.00 | 18 |
| train 2009-2011 / test 2012-2012 | MACross(20/50) | realistic | 6.68% | 0.58 | -9.90% | 18.27 | 916.48 | 2372 |
| train 2009-2011 / test 2012-2012 | BuyAndHold (baseline) | realistic | 17.60% | 1.38 | -9.32% | 0.81 | 45.00 | 18 |
| train 2010-2012 / test 2013-2013 | MACross(20/50) | realistic | 44.33% | 3.35 | -3.99% | 14.24 | 839.86 | 3074 |
| train 2010-2012 / test 2013-2013 | BuyAndHold (baseline) | realistic | 53.89% | 3.22 | -4.82% | 0.80 | 50.00 | 20 |
| train 2011-2013 / test 2014-2014 | MACross(20/50) | realistic | 14.67% | 1.28 | -7.06% | 15.67 | 816.31 | 2943 |
| train 2011-2013 / test 2014-2014 | BuyAndHold (baseline) | realistic | 23.83% | 1.60 | -7.75% | 0.91 | 50.00 | 20 |
| train 2012-2014 / test 2015-2015 | MACross(20/50) | realistic | 10.49% | 0.68 | -11.97% | 21.54 | 1,105.70 | 2356 |
| train 2012-2014 / test 2015-2015 | BuyAndHold (baseline) | realistic | 19.74% | 1.13 | -11.88% | 0.92 | 50.00 | 20 |
| train 2013-2015 / test 2016-2016 | MACross(20/50) | realistic | 25.11% | 2.17 | -5.10% | 13.69 | 744.94 | 2800 |
| train 2013-2015 / test 2016-2016 | BuyAndHold (baseline) | realistic | 25.10% | 1.65 | -9.77% | 0.92 | 50.00 | 20 |
| train 2014-2016 / test 2017-2017 | MACross(20/50) | realistic | 26.61% | 2.74 | -4.29% | 9.67 | 528.42 | 3231 |
| train 2014-2016 / test 2017-2017 | BuyAndHold (baseline) | realistic | 39.21% | 3.64 | -4.08% | 0.84 | 50.00 | 20 |
| train 2015-2017 / test 2018-2018 | MACross(20/50) | realistic | -5.93% | -0.27 | -15.56% | 23.58 | 1,142.84 | 2204 |
| train 2015-2017 / test 2018-2018 | BuyAndHold (baseline) | realistic | 0.31% | 0.12 | -19.96% | 0.95 | 50.00 | 20 |
| train 2016-2018 / test 2019-2019 | MACross(20/50) | realistic | 26.10% | 1.91 | -9.31% | 14.20 | 760.09 | 2952 |
| train 2016-2018 / test 2019-2019 | BuyAndHold (baseline) | realistic | 38.69% | 2.39 | -9.66% | 0.84 | 50.00 | 20 |
| train 2017-2019 / test 2020-2020 | MACross(20/50) | realistic | 64.69% | 2.20 | -10.42% | 18.23 | 1,200.61 | 2793 |
| train 2017-2019 / test 2020-2020 | BuyAndHold (baseline) | realistic | 64.05% | 1.55 | -31.55% | 0.82 | 50.00 | 20 |
| train 2018-2020 / test 2021-2021 | MACross(20/50) | realistic | 26.19% | 1.97 | -5.60% | 16.72 | 897.21 | 2898 |
| train 2018-2020 / test 2021-2021 | BuyAndHold (baseline) | realistic | 38.54% | 2.36 | -5.29% | 0.85 | 50.00 | 20 |
| train 2019-2021 / test 2022-2022 | MACross(20/50) | realistic | -17.39% | -0.63 | -29.91% | 28.92 | 1,290.16 | 1836 |
| train 2019-2021 / test 2022-2022 | BuyAndHold (baseline) | realistic | -14.98% | -0.58 | -21.62% | 1.14 | 50.00 | 20 |
| train 2020-2022 / test 2023-2023 | MACross(20/50) | realistic | 24.29% | 1.78 | -12.53% | 15.38 | 854.65 | 2697 |
| train 2020-2022 / test 2023-2023 | BuyAndHold (baseline) | realistic | 52.78% | 2.73 | -8.99% | 0.78 | 50.00 | 20 |
| train 2021-2023 / test 2024-2024 | MACross(20/50) | realistic | 16.84% | 1.30 | -8.98% | 16.64 | 887.77 | 2847 |
| train 2021-2023 / test 2024-2024 | BuyAndHold (baseline) | realistic | 42.35% | 2.59 | -8.41% | 0.82 | 50.00 | 20 |
| train 2022-2024 / test 2025-2025 | MACross(20/50) | realistic | 7.54% | 0.55 | -16.40% | 17.48 | 863.56 | 2322 |
| train 2022-2024 / test 2025-2025 | BuyAndHold (baseline) | realistic | 16.83% | 1.00 | -17.14% | 0.95 | 50.00 | 20 |
| train 2023-2025 / test 2026-2026 | MACross(20/50) | realistic | -0.55% | -0.00 | -6.89% | 21.62 | 785.28 | 1460 |
| train 2023-2025 / test 2026-2026 | BuyAndHold (baseline) | realistic | 12.71% | 1.20 | -7.98% | 1.32 | 50.00 | 20 |
| aggregate | MACross(20/50) | realistic | 15.08% | 0.91 | -30.73% | 18.60 | 91,357.86 | 46741 |
| aggregate | BuyAndHold (baseline) | realistic | 22.47% | 1.19 | -34.74% | 0.96 | 9,369.20 | 364 |

At 5 bps the crossover beat the `never` baseline on CAGR in **4 of 19** folds, but its aggregate test CAGR was **15.08% vs 22.47%**. **2008 and 2022 diverge:** in 2008 the crossover lost **12.55%** against `never` buy-and-hold's **22.95%** loss, with similar max drawdowns (**-30.73% vs -31.23%**). In 2022 it lost **17.39%** against the baseline's **14.98%** loss, and its max drawdown was **worse** (**-29.91% vs -21.62%**). Trend following did not reliably cushion drawdowns in these two bear-market years. The 2009 and 2020 recovery years should not be pooled with them to claim a general crisis advantage.

Running the same fixed crossover against `on_listing` gives **22.08% aggregate baseline CAGR and 1.09 Sharpe** at 5 bps, versus crossover **15.08% and 0.91**. At 0 bps the compounded aggregate CAGRs are **16.15%** for the crossover, **22.52%** for `never`, and **22.13%** for `on_listing`. Each one-year test fold starts a new portfolio; these aggregate numbers are distinct from the uninterrupted 2005–2026 runs above. The complete two-baseline, two-cost walk-forward table is printed by `python scripts/report_walkforward.py`.

The regime breakdown below takes the simple mean of each fold's CAGR, Sharpe, and **within-fold max drawdown**. Sustained drawdown contains **2008, 2018, 2022**; recovery contains **2009, 2020**; “steady bull” is the requested remainder of 14 folds, including partial 2026. Max drawdown is negative; a value closer to zero means a shallower drawdown. These labels describe selected calendar years, not a regime classifier that could identify them in advance.

| Baseline | Cost | Regime (folds) | Crossover CAGR | Baseline CAGR | Crossover Sharpe | Baseline Sharpe | Crossover MaxDD | Baseline MaxDD |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `never` | 0 bps | Sustained drawdown (3) | -10.74% | -12.49% | -0.331 | -0.443 | -24.87% | -24.24% |
| `never` | 0 bps | Recovery (2) | 58.69% | 50.71% | 2.232 | 1.582 | -9.36% | -23.87% |
| `never` | 0 bps | Steady bull (14) | 17.83% | 28.71% | 1.414 | 1.873 | -9.96% | -9.41% |
| `never` | 5 bps | Sustained drawdown (3) | -11.96% | -12.54% | -0.390 | -0.445 | -25.40% | -24.27% |
| `never` | 5 bps | Recovery (2) | 57.45% | 50.66% | 2.197 | 1.580 | -9.41% | -23.88% |
| `never` | 5 bps | Steady bull (14) | 16.84% | 28.66% | 1.349 | 1.869 | -10.08% | -9.41% |
| `on_listing` | 0 bps | Sustained drawdown (3) | -10.74% | -15.49% | -0.331 | -0.421 | -24.87% | -28.18% |
| `on_listing` | 0 bps | Recovery (2) | 58.69% | 53.78% | 2.232 | 1.531 | -9.36% | -25.87% |
| `on_listing` | 0 bps | Steady bull (14) | 17.83% | 28.87% | 1.414 | 1.865 | -9.96% | -9.93% |
| `on_listing` | 5 bps | Sustained drawdown (3) | -11.96% | -15.54% | -0.390 | -0.423 | -25.40% | -28.21% |
| `on_listing` | 5 bps | Recovery (2) | 57.45% | 53.72% | 2.197 | 1.529 | -9.41% | -25.88% |
| `on_listing` | 5 bps | Steady bull (14) | 16.84% | 28.82% | 1.349 | 1.861 | -10.08% | -9.94% |

Against the default `never` baseline, the crossover's mean sustained-drawdown CAGR is slightly higher at 5 bps, but its **mean max drawdown is deeper**. The stronger recovery-year figures should not be used as evidence that it protects capital through sustained declines.

The individual sustained-drawdown folds at **5 bps** show why the average alone is inadequate:

| Test year | Crossover CAGR | `never` CAGR | `on_listing` CAGR | Crossover MaxDD | `never` MaxDD | `on_listing` MaxDD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2008 | -12.55% | -22.95% | -31.94% | -30.73% | -31.23% | -43.04% |
| 2018 | -5.93% | 0.31% | 0.31% | -15.56% | -19.96% | -19.96% |
| 2022 | -17.39% | -14.98% | -14.98% | -29.91% | -21.62% | -21.62% |

The momentum sweep selected each pair on train data only. `Gap` means train Sharpe minus test Sharpe; the baseline column is buy-and-hold test Sharpe with the same costs.

| Test year | N months | Top k | Costs | Train Sharpe | Test Sharpe | Gap | Baseline test Sharpe |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 2008 | 3 | 10 | 0 bps | 1.749 | -0.826 | 2.575 | -0.867 |
| 2008 | 3 | 10 | 5 bps | 1.733 | -0.833 | 2.566 | -0.868 |
| 2009 | 3 | 10 | 0 bps | 0.281 | 1.408 | -1.127 | 1.613 |
| 2009 | 3 | 10 | 5 bps | 0.272 | 1.398 | -1.126 | 1.611 |
| 2010 | 3 | 10 | 0 bps | 0.465 | 0.359 | 0.106 | 0.676 |
| 2010 | 3 | 10 | 5 bps | 0.457 | 0.339 | 0.118 | 0.673 |
| 2011 | 12 | 5 | 0 bps | 0.839 | 0.151 | 0.687 | 0.614 |
| 2011 | 12 | 5 | 5 bps | 0.826 | 0.139 | 0.688 | 0.612 |
| 2012 | 3 | 5 | 0 bps | 0.879 | 1.135 | -0.256 | 1.378 |
| 2012 | 3 | 5 | 5 bps | 0.861 | 1.100 | -0.240 | 1.375 |
| 2013 | 6 | 10 | 0 bps | 0.922 | 3.353 | -2.431 | 3.216 |
| 2013 | 6 | 10 | 5 bps | 0.911 | 3.335 | -2.425 | 3.212 |
| 2014 | 9 | 3 | 0 bps | 2.018 | 1.567 | 0.451 | 1.596 |
| 2014 | 9 | 3 | 5 bps | 2.007 | 1.558 | 0.449 | 1.593 |
| 2015 | 6 | 10 | 0 bps | 2.203 | 1.126 | 1.077 | 1.128 |
| 2015 | 6 | 10 | 5 bps | 2.190 | 1.113 | 1.077 | 1.125 |
| 2016 | 3 | 5 | 0 bps | 1.823 | 1.584 | 0.239 | 1.654 |
| 2016 | 3 | 5 | 5 bps | 1.803 | 1.552 | 0.252 | 1.650 |
| 2017 | 3 | 3 | 0 bps | 1.746 | 2.161 | -0.415 | 3.636 |
| 2017 | 3 | 3 | 5 bps | 1.724 | 2.128 | -0.404 | 3.631 |
| 2018 | 3 | 3 | 0 bps | 1.827 | 0.049 | 1.777 | 0.120 |
| 2018 | 3 | 3 | 5 bps | 1.803 | 0.028 | 1.775 | 0.118 |
| 2019 | 3 | 3 | 0 bps | 1.241 | 2.338 | -1.097 | 2.388 |
| 2019 | 3 | 3 | 5 bps | 1.219 | 2.301 | -1.082 | 2.383 |
| 2020 | 3 | 10 | 0 bps | 1.246 | 1.558 | -0.312 | 1.544 |
| 2020 | 3 | 10 | 5 bps | 1.227 | 1.549 | -0.323 | 1.543 |
| 2021 | 3 | 3 | 0 bps | 1.574 | 1.998 | -0.423 | 2.354 |
| 2021 | 3 | 3 | 5 bps | 1.561 | 1.974 | -0.413 | 2.351 |
| 2022 | 3 | 5 | 0 bps | 1.915 | -1.004 | 2.919 | -0.579 |
| 2022 | 3 | 5 | 5 bps | 1.902 | -1.028 | 2.930 | -0.582 |
| 2023 | 3 | 3 | 0 bps | 1.507 | 1.479 | 0.028 | 2.724 |
| 2023 | 3 | 3 | 5 bps | 1.492 | 1.458 | 0.034 | 2.721 |
| 2024 | 6 | 5 | 0 bps | 1.202 | 1.947 | -0.744 | 2.588 |
| 2024 | 6 | 5 | 5 bps | 1.190 | 1.934 | -0.745 | 2.585 |
| 2025 | 9 | 5 | 0 bps | 1.838 | 0.252 | 1.586 | 1.001 |
| 2025 | 9 | 5 | 5 bps | 1.829 | 0.237 | 1.592 | 0.998 |
| 2026 partial | 9 | 10 | 0 bps | 1.425 | 0.941 | 0.484 | 1.207 |
| 2026 partial | 9 | 10 | 5 bps | 1.416 | 0.925 | 0.491 | 1.201 |

The average gap was **0.270 Sharpe points at 0 bps** and **0.274 at 5 bps**. At realistic costs, selected momentum beat the baseline's test Sharpe in **3 of 19** folds. Individual train/test gaps have both signs, so these runs do not support a claim that test Sharpe must always be lower.

## Limitations

- **Survivorship and selection bias:** this is a present-day set of 20 large-cap companies, not a reconstructed historical top-20 membership list. Selecting today's surviving large companies can select for past success. The code does not verify that these are literally the current top 20 by market capitalization.
- **Incomplete early universe:** six names were not yet listed in 2005. The reported `never` baseline holds only the 14 initially tradable names and leaves the other target allocations in cash. The `on_listing` baseline includes those names only after they first trade, and rebalances each time one arrives. This choice materially changes the comparison.
- **Limited independence:** 19 test folds cover more regimes than the old five-year sample, including 2008, 2020, and 2022, but the rolling training windows overlap and the folds come from one US equity history. The final 2026 fold is partial.
- **Only one asset class:** the universe is US large-cap equities. Results do not establish behavior in bonds, international equities, small caps, or other markets.
- **Data quality:** the flags above remain unresolved. A calendar mismatch, genuine gap, adjusted-price anomaly, or real price shock can affect results and deserves inspection before stronger claims.
- **Live trading differs:** executable fills, changing spreads and impact, order failures, taxes, funding, and data revisions are not fully captured by a fixed 5 bps model. Backtest returns are not forecasts of live returns.

The measured conclusion is narrow: the fixed crossover and train-selected momentum each **trailed buy-and-hold on their aggregate or average reported test comparison** in this snapshot. Both had individual folds that beat it. The sample does not prove a general ordering of strategies.

## Setup and run

Use Python 3.9 or newer from the repository root. The processed Parquet snapshot is committed, so the commands below do not download market data.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m pytest -q
python scripts/run_backtest.py
python scripts/report_walkforward.py
python scripts/param_sweep.py
python -m flask --app app.wsgi:app run
```

Open `http://127.0.0.1:5000/` for the form. The app reads the committed Parquet file and fails at startup if it is missing. To regenerate the snapshot deliberately, run `python scripts/build_dataset.py` or supply `--start YYYY-MM-DD --end YYYY-MM-DD` (inclusive end), inspect its printed validation issues, and review the changed Parquet before committing it.

### Static viewer

[`scripts/precompute_results.py`](scripts/precompute_results.py) runs the fixed 20/50 crossover, fixed 6-month/top-5 momentum strategy, and all four buy-and-hold rebalance modes on the full snapshot and each of the 19 one-year test folds, at 0 and 5 bps. It writes a manifest plus one JSON file per strategy and cost level to [`static/data/`](static/data/). The static momentum preset is **fixed 6/5**; it is not the train-selected momentum parameter sweep reported above. Regenerate and review these committed JSON files whenever the Parquet snapshot or strategy code changes:

```bash
python scripts/precompute_results.py
python -m http.server 8000 --directory static
```

Open `http://127.0.0.1:8000/`. [`static/index.html`](static/index.html) loads only the generated JSON and Chart.js from a CDN. Its strategy, baseline, cost, and period selectors change which saved series and metrics are displayed; the page does no backtesting and needs no Python server in deployment. [`vercel.json`](vercel.json) serves the `static/` directory as the Vercel site without a build command. The Flask form remains available for local exploration of arbitrary date ranges; its requests still run backtests against the cached Parquet.

For a local container, run `docker build -t quantlab .` and `docker run --rm -p 10000:10000 quantlab`. The [Render Blueprint](render.yaml) uses the same Dockerfile. The image copies the committed snapshot and does not call yfinance during build or requests.
