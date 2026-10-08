# Quantlab

**[Backtest lab](https://quantlab-backtester.onrender.com/)** · **[Market explorer](https://quantlab-backtester.onrender.com/markets.html)**

Quantlab lets you explore historical stock strategies beside a buy-and-hold baseline. The lab shows what a hypothetical investment would have become, plus yearly test results. The market explorer has saved price history and a separate one-minute TradingView chart. Neither page predicts future returns.

## How the backtest works

The committed dataset contains adjusted daily prices for **20 selected US large-cap stocks**, from January 2005 through September 2026. Prices come from yfinance. Stocks that listed later have no price before their first trading day.

- A strategy sees data only through the current daily bar. Its decision executes at the **next bar's open**.
- Results always include a buy-and-hold comparison at **0 and 5 basis points** of trading costs. The 5 bps model includes commission, spread, and slippage.
- The default buy-and-hold baseline buys whatever is tradable at the start and never rebalances. The **on listing** option starts in available stocks and rebalances when a new stock begins trading. They are different portfolios.
- Walk-forward testing uses three training years followed by one test year. The current snapshot has **19 test years**; 2026 is partial.

The lab's controls select [precomputed results](static/data/). They do not rerun the strategy in your browser. The Flask form at the repository root supports local backtests over arbitrary date ranges.

## What the results show

The fixed 20/50 moving-average crossover's compounded walk-forward test CAGR was **16.15% vs 22.52%** for default buy-and-hold at 0 bps, and **15.08% vs 22.47%** at 5 bps. It beat the baseline in **4 of 19** test years at either cost level. In 2008 it lost less than buy-and-hold; in 2022 it lost more and had a deeper drawdown. Those years should be read separately.

The momentum parameter sweep chooses settings using each training period only. Its average train-to-test Sharpe gap was **0.270 at 0 bps** and **0.274 at 5 bps**; it beat the baseline's test Sharpe in **3 of 19** folds at 5 bps. The fixed momentum preset shown in the lab is a different run from this train-selected sweep. Use `python scripts/param_sweep.py` for the complete sweep table.

These results come from one historical US equity sample. The 20 stocks were selected from companies known today, which biases the past toward survivors. Trading costs are simplified, data flags remain for review, and live orders can fill differently. A backtest is evidence about its assumptions, not a forecast.

## Run it locally

Use Python 3.9 or newer from the repository root. The committed dataset means setup does not need a market-data download.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m pytest -q
python -m flask --app app.wsgi:app run
```

Open `http://127.0.0.1:5000/` for the Flask form. To serve the static dashboard locally, run `python -m http.server 8000 --directory static` and open `http://127.0.0.1:8000/`.

To print the detailed fixed-strategy comparisons, run:

```bash
python scripts/run_backtest.py
python scripts/report_walkforward.py
python scripts/param_sweep.py
```

To deliberately refresh the daily dataset, run `python scripts/build_dataset.py --start 2005-01-01 --end YYYY-MM-DD`. Review the validation issues it prints; flagged rows are not silently changed. Then run `python scripts/precompute_results.py` and `python scripts/precompute_market.py` to update the static exports.

The market explorer includes **10 additional stocks** that are not part of the backtest universe. Refresh their history with `python scripts/build_market_extras.py` before `python scripts/precompute_market.py`. Its latest Finnhub quote is separate from the saved adjusted history; the TradingView one-minute chart may use delayed exchange data. Gold and Bitcoin are chart-only entries in the same market list. They do not change the stock backtests.

For each stock, Markets also shows **customizable 1- to 20-year historical scenarios**, limited by how much history that stock has. Choose a whole-year horizon and a bearish, moderate, or bullish outcome. Each endpoint uses the 10th, 50th, or 90th percentile of past same-horizon returns. The future line replays the monthly closes of an actual past window whose total return was close to that outcome, rescaled to meet the endpoint. A history detail chart keeps its own price range so long projections cannot flatten the past. The extended chart reserves separate width for history and the illustrative future path, shows at least three years of past data even with a shorter close-up selected, and defaults to a logarithmic price scale. Markets opens with a four-year historical range. Its dollar figures are adjusted-price equivalents, not future quoted share prices. These analog paths are not predictions or executable quotes; they omit trading costs and taxes. Gold and Bitcoin have no scenarios because their saved historical series are not in the dataset.

The [Dockerfile](Dockerfile) and [Render configuration](render.yaml) serve the Flask app from committed data. [vercel.json](vercel.json) serves the static dashboard.
