# Quantlab

**[Backtest lab](https://quantlab-backtester.onrender.com/)** · **[Market explorer](https://quantlab-backtester.onrender.com/markets.html)**

Quantlab lets you explore historical stock strategies beside a buy-and-hold baseline. The lab shows what a hypothetical investment would have become, plus yearly test results. The market explorer has saved price history and a separate one-minute TradingView chart. Neither page predicts future returns.

## How the backtest works

The committed dataset contains adjusted daily prices for **20 selected US large-cap stocks**, from January 2005 through the snapshot date shown in the app. Prices come from yfinance. Stocks that listed later have no price before their first trading day.

- A strategy sees data only through the current daily bar. Its decision executes at the **next bar's open**.
- Results always include a buy-and-hold comparison at **0 and 5 basis points** of trading costs. The 5 bps model includes commission, spread, and slippage.
- The default buy-and-hold baseline buys whatever is tradable at the start and never rebalances. The **on listing** option starts in available stocks and rebalances when a new stock begins trading. They are different portfolios.
- Walk-forward testing uses three training years followed by one test year. The current snapshot has **19 test years**; 2026 is partial.

The lab's controls select [precomputed results](static/data/). They do not rerun the strategy in your browser. The Flask form at the repository root supports local backtests over arbitrary date ranges.

## What the results show

Run `python scripts/report_walkforward.py` for the latest crossover versus buy-and-hold results at both 0 and 5 bps. The momentum parameter sweep chooses settings using each training period only; run `python scripts/param_sweep.py` for its latest train-to-test comparison. The fixed momentum preset shown in the lab is a different run from this train-selected sweep.

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

To refresh all stock prices and rebuild both the market explorer and backtest exports together, run `python scripts/refresh_snapshot.py` from the repository root. It requests prices through yesterday's completed session by default, validates every stock, stages all outputs, and publishes them only after the builds succeed. Previously reviewed large-move flags are recognized from the committed snapshot. New flags stop publication; review them before rerunning with `--allow-flags`. You can also set `--end YYYY-MM-DD` explicitly.

The market explorer includes **10 additional stocks** that are not part of the backtest universe. Refresh their history with `python scripts/build_market_extras.py` before `python scripts/precompute_market.py`. Its latest Finnhub quote is separate from the saved adjusted history; the TradingView one-minute chart may use delayed exchange data. Gold and Bitcoin are chart-only entries in the same market list. They do not change the stock backtests.

The Markets page has a compact, searchable market picker above the chart. Each stock links to a dedicated **Forecast** page with customizable 1- to 20-year historical scenarios, limited by how much history that stock has. Choose a whole-year horizon and a bearish, moderate, or bullish outcome. Each endpoint uses the 10th, 50th, or 90th percentile of past same-horizon returns. The future line replays the monthly closes of an actual past window whose total return was close to that outcome, rescaled to meet the endpoint. Markets has its own saved-history range control; Forecast has a separate history-range control, both opening at four years. The forecast chart reserves width for history and the illustrative future path and defaults to a logarithmic price scale. Its dollar figures are adjusted-price equivalents, not future quoted share prices. These analog paths are not predictions or executable quotes; they omit trading costs and taxes. Gold and Bitcoin have no scenarios because their saved historical series are not in the dataset.

The market explorer also reports a historical holdout check for horizons with at least five completed yearly starting points. At each point it calculates scenario returns from earlier prices only, then compares the later return with the selected scenario and an unchanged-price baseline. It shows median return error in percentage points and how often the actual return fell between the bearish and bullish estimates. Multi-year tests overlap, and this is an evaluation of return estimates, not trading performance.

The [Dockerfile](Dockerfile) and [Render configuration](render.yaml) serve the Flask app from committed data. [vercel.json](vercel.json) serves the static dashboard.
