let market;
let selectedSymbol;
let selectedDetailRange = "4Y";
let selectedExtendedRange = "4Y";
let selectedView = "history";
let selectedForecastYears = 5;
let selectedForecastView = "moderate";
let selectedForecastScale = "logarithmic";
let selectedAsset = "GOLD";
let selectedMarketKind = "asset";
let priceChart;
let historyDetailChart;
const forecastPaths = new Map();
const forecastPending = new Map();
const providerQuotes = new Map();
const quotePending = new Set();
const QUOTE_API_BASE = "https://quantlab-backtester.onrender.com/api/quote/";
const TRADINGVIEW_SYMBOLS = {
  AAPL: "NASDAQ:AAPL", ABBV: "NYSE:ABBV", ADBE: "NASDAQ:ADBE",
  AMD: "NASDAQ:AMD", AMZN: "NASDAQ:AMZN", AVGO: "NASDAQ:AVGO",
  BAC: "NYSE:BAC", "BRK-B": "NYSE:BRK.B", COST: "NASDAQ:COST",
  CRM: "NYSE:CRM", DIS: "NYSE:DIS", GOOGL: "NASDAQ:GOOGL",
  HD: "NYSE:HD", JNJ: "NYSE:JNJ", JPM: "NYSE:JPM",
  KO: "NYSE:KO", MA: "NYSE:MA", MCD: "NYSE:MCD",
  META: "NASDAQ:META", MSFT: "NASDAQ:MSFT", NFLX: "NASDAQ:NFLX",
  NVDA: "NASDAQ:NVDA", ORCL: "NYSE:ORCL", PEP: "NASDAQ:PEP",
  PG: "NYSE:PG", TSLA: "NASDAQ:TSLA", UNH: "NYSE:UNH",
  V: "NYSE:V", WMT: "NASDAQ:WMT", XOM: "NYSE:XOM"
};
const OTHER_MARKETS = [
  {id: "GOLD", label: "Spot gold", title: "Gold spot / US dollar", type: "Spot metal quote", symbol: "OANDA:XAUUSD"},
  {id: "BTC", label: "Bitcoin", title: "Bitcoin / US dollar", type: "Bitstamp spot market", symbol: "BITSTAMP:BTCUSD"}
];

const byId = id => document.getElementById(id);
const dollars = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});
const ranges = {"1M": 1, "6M": 6, "1Y": 12, "2Y": 24, "3Y": 36, "4Y": 48, "5Y": 60, "10Y": 120};

function money(value) { return Number.isFinite(value) ? dollars.format(value) : "—"; }
function percent(value) { return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%` : "—"; }

function paintProviderQuote(quote) {
  if (selectedSymbol !== quote.symbol) return;
  byId("provider-price").textContent = money(quote.price);
  const change = byId("provider-change");
  change.textContent = `${quote.change >= 0 ? "+" : ""}${money(quote.change)} (${percent(quote.change_percent / 100)})`;
  change.className = `provider-change ${quote.change >= 0 ? "positive" : "negative"}`;
  const quoteDate = quote.quote_time || quote.fetched_at;
  const label = quote.quote_time ? "Quote time" : "Checked";
  const formatted = new Date(quoteDate).toLocaleString("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short"
  });
  byId("provider-status").textContent = `${label}: ${formatted}`;
}

async function refreshProviderQuote() {
  const symbol = selectedSymbol;
  if (quotePending.has(symbol)) return;
  const cached = providerQuotes.get(symbol);
  if (cached && Date.now() - cached.loadedAt < 60000) {
    paintProviderQuote(cached.quote);
    return;
  }
  quotePending.add(symbol);
  byId("provider-status").textContent = "Checking latest quote…";
  try {
    const response = await fetch(`${QUOTE_API_BASE}${encodeURIComponent(symbol)}`, {cache: "no-store"});
    if (!response.ok) throw new Error(`Quote service returned ${response.status}`);
    const quote = await response.json();
    if (quote.symbol !== symbol) throw new Error("Quote symbol mismatch");
    providerQuotes.set(symbol, {quote, loadedAt: Date.now()});
    paintProviderQuote(quote);
  } catch (_error) {
    if (selectedSymbol === symbol) {
      byId("provider-price").textContent = "—";
      byId("provider-change").textContent = "—";
      byId("provider-status").textContent = "Latest quote unavailable. Saved history remains available.";
    }
  } finally {
    quotePending.delete(symbol);
  }
}

function rangeStart(lastDate, range) {
  if (range === "ALL") return "0000-01-01";
  const date = new Date(`${lastDate}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - ranges[range]);
  return date.toISOString().slice(0, 10);
}

function historyDateLabel(value, range) {
  const options = range === "1M"
    ? {month: "short", day: "numeric", timeZone: "UTC"}
    : {year: "numeric", month: "short", timeZone: "UTC"};
  return new Date(Number(value)).toLocaleDateString("en-US", options);
}

function chartColor(variable) {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

function maxForecastYears(stock) {
  return Math.max(...Object.keys(stock.historical_scenarios || {}).map(Number));
}

async function ensureForecastPaths(symbol, stock) {
  if (forecastPaths.has(symbol)) return forecastPaths.get(symbol);
  if (forecastPending.has(symbol)) return forecastPending.get(symbol);
  const pending = (async () => {
    const response = await fetch(stock.forecast_path);
    if (!response.ok) throw new Error(`Could not load forecast paths (${response.status})`);
    const paths = await response.json();
    forecastPaths.set(symbol, paths);
    return paths;
  })();
  forecastPending.set(symbol, pending);
  try {
    return await pending;
  } finally {
    forecastPending.delete(symbol);
  }
}

function renderChart(stock) {
  if (!window.Chart) throw new Error("Chart.js did not load from the CDN.");
  byId("detail-history-caption").textContent = `Close-up through ${stock.last_date} · own price scale`;
  byId("extended-history-caption").textContent = `Saved through ${stock.last_date} · future path is illustrative`;
  const start = rangeStart(stock.last_date, selectedDetailRange);
  const first = stock.dates.findIndex(date => date >= start);
  const dates = stock.dates.slice(Math.max(first, 0));
  const values = stock.adjusted_close.slice(Math.max(first, 0));
  const detailFirstDate = Date.parse(`${dates[0]}T00:00:00Z`);
  const lastDate = Date.parse(`${stock.last_date}T00:00:00Z`);
  if (historyDetailChart) historyDetailChart.destroy();
  historyDetailChart = new Chart(byId("history-detail-canvas"), {
    type: "line",
    data: {datasets: [{
      label: `${selectedSymbol} saved adjusted close`,
      data: dates.map((date, index) => ({x: Date.parse(`${date}T00:00:00Z`), y: values[index]})),
      borderColor: chartColor("--accent"), backgroundColor: chartColor("--accent"),
      borderWidth: 2, pointRadius: 0, tension: 0
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      plugins: {legend: {display: false}, tooltip: {callbacks: {
        title: items => new Date(items[0].parsed.x).toLocaleDateString("en-US", {year: "numeric", month: "short", day: "numeric", timeZone: "UTC"}),
        label: item => money(item.parsed.y)
      }}},
      scales: {
        x: {type: "linear", min: detailFirstDate, max: lastDate, ticks: {color: chartColor("--muted"), maxTicksLimit: 7,
          callback: value => historyDateLabel(value, selectedDetailRange)},
          grid: {display: false}},
        y: {type: selectedForecastScale, ticks: {color: chartColor("--muted"), maxTicksLimit: 5,
          callback: value => money(Number(value))}, grid: {color: chartColor("--grid")}}
      }
    }
  });
  const scenario = stock.historical_scenarios[String(selectedForecastYears)];
  const analog = forecastPaths.get(selectedSymbol)?.[String(selectedForecastYears)]?.[selectedForecastView];
  const candles = analog?.bars || [];
  const extendedStart = rangeStart(stock.last_date, selectedExtendedRange);
  const extendedFirst = stock.dates.findIndex(date => date >= extendedStart);
  const extendedDates = stock.dates.slice(Math.max(extendedFirst, 0));
  const extendedValues = stock.adjusted_close.slice(Math.max(extendedFirst, 0));
  const firstDate = Date.parse(`${extendedDates[0]}T00:00:00Z`);
  const split = {"1Y": .48, "2Y": .52, "3Y": .54, "4Y": .56, "5Y": .58, "10Y": .58, "ALL": .58}[selectedExtendedRange];
  const endDate = Date.parse(`${scenario.through_date}T00:00:00Z`);
  const historyX = date => split * (date - firstDate) / (lastDate - firstDate);
  const futureX = date => split + (1 - split) * (date - lastDate) / (endDate - lastDate);
  const dateAtX = x => x <= split
    ? firstDate + x / split * (lastDate - firstDate)
    : lastDate + (x - split) / (1 - split) * (endDate - lastDate);
  const datasets = [{
    label: `${selectedSymbol} history`,
    data: extendedDates.map((date, index) => ({x: historyX(Date.parse(`${date}T00:00:00Z`)), y: extendedValues[index]})),
    borderColor: chartColor("--accent"), backgroundColor: chartColor("--accent"),
    borderWidth: 2, pointRadius: 0, tension: 0
  }];
  if (candles.length) {
    datasets.push({
      label: `${selectedForecastView[0].toUpperCase()}${selectedForecastView.slice(1)} illustrative path`,
      data: [{x: split, y: stock.last_close}, ...candles.map(candle => ({
        x: futureX(Date.parse(`${candle[0]}T00:00:00Z`)), y: candle[4]
      }))],
      borderColor: chartColor("--forecast-up"), backgroundColor: chartColor("--forecast-up"),
      borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 0, hitRadius: 10, tension: 0
    });
  }
  const forecastRegionPlugin = {
    id: "forecastRegion",
    beforeDatasetsDraw(chart) {
      const {ctx, chartArea, scales: {x}} = chart;
      const divider = x.getPixelForValue(split);
      ctx.save();
      ctx.beginPath();
      ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
      ctx.clip();
      ctx.globalAlpha = .3;
      ctx.fillStyle = chartColor("--surface-muted");
      ctx.fillRect(divider, chartArea.top, chartArea.right - divider, chartArea.bottom - chartArea.top);
      ctx.globalAlpha = .75;
      ctx.strokeStyle = chartColor("--muted");
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(divider, chartArea.top);
      ctx.lineTo(divider, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };
  const projectedCloses = candles.map(candle => candle[4]);
  const minimum = Math.min(...extendedValues, ...projectedCloses) * .92;
  const maximum = Math.max(...extendedValues, ...projectedCloses) * 1.08;
  if (priceChart) priceChart.destroy();
  priceChart = new Chart(byId("stock-chart"), {
    type: "line",
    data: {datasets},
    plugins: [forecastRegionPlugin],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: {mode: "nearest", intersect: false},
      plugins: {
        legend: {display: true, labels: {color: chartColor("--muted")}},
        tooltip: {callbacks: {
          title: items => new Date(dateAtX(items[0].parsed.x)).toLocaleDateString("en-US", {year: "numeric", month: "short", day: "numeric", timeZone: "UTC"}),
          label: context => `${context.dataset.label}: ${money(context.parsed.y)}`
        }}
      },
      scales: {
        x: {type: "linear", min: 0, max: 1, ticks: {
          color: chartColor("--muted"), maxTicksLimit: 8, maxRotation: 0,
          callback: value => Number(value) <= split
            ? historyDateLabel(dateAtX(Number(value)), selectedExtendedRange)
            : new Date(dateAtX(Number(value))).toLocaleDateString("en-US", selectedForecastYears <= 2
              ? {year: "numeric", month: "short", timeZone: "UTC"}
              : {year: "numeric", timeZone: "UTC"})
        }, grid: {display: false}},
        y: {type: selectedForecastScale, min: minimum, max: maximum,
          ticks: {color: chartColor("--muted"), maxTicksLimit: 8, callback: value => money(Number(value))},
          grid: {color: chartColor("--grid")}}
      }
    }
  });
}

function mountTradingView(target, symbol) {
  target.replaceChildren();
  const container = document.createElement("div");
  container.className = "tradingview-widget-container";
  const widget = document.createElement("div");
  widget.className = "tradingview-widget-container__widget";
  container.append(widget);
  const script = document.createElement("script");
  script.type = "text/javascript";
  script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  script.async = true;
  script.textContent = JSON.stringify({
    autosize: true, symbol, interval: "1", timezone: "America/New_York",
    theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    style: "1", locale: "en", allow_symbol_change: false,
    hide_side_toolbar: true, hide_top_toolbar: false, hide_legend: false,
    hide_volume: false, withdateranges: false, calendar: false,
    support_host: "https://www.tradingview.com"
  });
  container.append(script);
  target.append(container);
}

function renderIntradayChart() {
  const target = byId("intraday-chart");
  const symbol = TRADINGVIEW_SYMBOLS[selectedSymbol];
  if (!symbol) {
    target.textContent = "A one-minute chart is not configured for this symbol.";
    return;
  }
  byId("open-tradingview").href = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
  mountTradingView(target, symbol);
}

function renderAsset() {
  const asset = OTHER_MARKETS.find(item => item.id === selectedAsset);
  byId("asset-type").textContent = asset.type;
  byId("asset-title").textContent = asset.title;
  byId("asset-symbol").textContent = asset.symbol;
  byId("asset-full-chart").href = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(asset.symbol)}`;
  byId("asset-chart").setAttribute("aria-label", `One-minute chart for ${asset.title}`);
  mountTradingView(byId("asset-chart"), asset.symbol);
}

function showMarket(kind) {
  selectedMarketKind = kind;
  byId("asset-main").hidden = kind !== "asset";
  byId("stock-main").hidden = kind !== "stock";
  if (kind === "stock") byId("asset-chart").replaceChildren();
  else byId("intraday-chart").replaceChildren();
  for (const row of document.querySelectorAll(".symbol-row")) {
    const active = row.dataset.asset
      ? kind === "asset" && row.dataset.asset === selectedAsset
      : kind === "stock" && row.dataset.symbol === selectedSymbol;
    row.setAttribute("aria-pressed", String(active));
  }
}

function setChartView(view) {
  selectedView = view;
  const url = new URL(window.location.href);
  if (view === "intraday") url.searchParams.set("view", "intraday");
  else url.searchParams.delete("view");
  history.replaceState(null, "", url);
  for (const button of document.querySelectorAll("[data-view]")) {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  byId("intraday-note").hidden = view !== "intraday";
  byId("history-caption").hidden = view !== "history";
  byId("chart-kicker").textContent = view === "intraday"
    ? "Intraday market chart · USD" : "Adjusted price history · USD";
  byId("intraday-chart").hidden = view !== "intraday";
  byId("history-chart").hidden = view !== "history";
  byId("history-detail-chart").hidden = view !== "history";
  for (const heading of document.querySelectorAll(".chart-panel-heading")) heading.hidden = view !== "history";
  for (const bar of document.querySelectorAll(".range-bar")) bar.hidden = view !== "history";
  byId("forecast-controls").hidden = view !== "history";
  byId("forecast-panel").hidden = view !== "history";
  if (view === "intraday") renderIntradayChart();
  else renderChart(market.symbols[selectedSymbol]);
}

function marketRow(name, detail, trailing, active, onSelect) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "symbol-row";
  row.setAttribute("aria-pressed", String(active));
  const label = document.createElement("span");
  const ticker = document.createElement("span");
  ticker.className = "ticker";
  ticker.textContent = name;
  const sub = document.createElement("span");
  sub.className = "row-price";
  sub.textContent = detail;
  label.append(ticker, sub);
  row.append(label, trailing);
  row.addEventListener("click", onSelect);
  return row;
}

function selectMarket(param, value) {
  const url = new URL(window.location.href);
  url.searchParams.set(param, value);
  url.searchParams.delete(param === "asset" ? "symbol" : "asset");
  history.replaceState(null, "", url);
}

function renderList() {
  const query = byId("symbol-search").value.trim().toUpperCase();
  const list = byId("symbol-list");
  list.replaceChildren();
  for (const asset of OTHER_MARKETS) {
    if (!asset.id.includes(query) && !asset.label.toUpperCase().includes(query)) continue;
    const tag = document.createElement("span");
    tag.className = "row-tag";
    tag.textContent = "1m chart";
    const row = marketRow(asset.id, asset.label, tag,
      selectedMarketKind === "asset" && asset.id === selectedAsset, () => {
        selectedAsset = asset.id;
        selectMarket("asset", asset.id);
        showMarket("asset");
        renderAsset();
      });
    row.dataset.asset = asset.id;
    list.append(row);
  }
  for (const [symbol, stock] of Object.entries(market.symbols)) {
    if (!symbol.includes(query)) continue;
    const change = document.createElement("span");
    change.className = `row-change ${stock.daily_change >= 0 ? "positive" : "negative"}`;
    change.textContent = percent(stock.daily_change);
    const row = marketRow(symbol, money(stock.last_close), change,
      selectedMarketKind === "stock" && symbol === selectedSymbol, () => {
        selectedSymbol = symbol;
        selectMarket("symbol", symbol);
        showMarket("stock");
        renderStock();
      });
    row.dataset.symbol = symbol;
    list.append(row);
  }
  if (!list.children.length) {
    const empty = document.createElement("p");
    empty.className = "caption";
    empty.textContent = "No symbols match your search.";
    list.append(empty);
  }
}

function renderForecast(stock) {
  const body = byId("forecast-body");
  body.replaceChildren();
  const maximum = maxForecastYears(stock);
  selectedForecastYears = Math.min(selectedForecastYears, maximum);
  byId("forecast-years").max = String(maximum);
  byId("forecast-years").value = String(selectedForecastYears);
  byId("forecast-limit").textContent = `Choose 1–${maximum} whole years for ${selectedSymbol}. The chart reserves space for both history and the illustrative future path. The logarithmic price scale keeps long horizons readable.`;
  byId("forecast-as-of").textContent = `Based on ${stock.last_date} adjusted close: ${money(stock.last_close)}`;
  const scenario = stock.historical_scenarios[String(selectedForecastYears)];
  const row = document.createElement("tr");
  const horizon = document.createElement("th");
  horizon.scope = "row";
  horizon.textContent = `${selectedForecastYears} ${selectedForecastYears === 1 ? "year" : "years"} · to ${scenario.through_date}`;
  row.append(horizon);
  for (const name of ["bearish", "moderate", "bullish"]) {
    const cell = document.createElement("td");
    const outcome = scenario.outcomes[name];
    const price = document.createElement("strong");
    price.textContent = money(outcome.adjusted_price);
    const change = document.createElement("span");
    change.textContent = `${percent(outcome.total_return)} total`;
    cell.append(price, change);
    row.append(cell);
  }
  body.append(row);
  const evaluation = stock.scenario_evaluation?.[String(selectedForecastYears)];
  byId("forecast-evaluation").textContent = evaluation
    ? `${evaluation.sample_count} yearly starting points (${evaluation.first_origin} to ${evaluation.last_origin}): median return error was ${evaluation.median_error_pp[selectedForecastView].toFixed(2)} percentage points for the ${selectedForecastView} scenario versus ${evaluation.flat_baseline_error_pp.toFixed(2)} for an unchanged-price baseline. The actual return fell between bearish and bullish in ${(evaluation.range_coverage * 100).toFixed(1)}% of checks. Multi-year checks overlap; this is not trading performance.`
    : `Not enough completed historical periods to check the ${selectedForecastYears}-year scenario against later prices.`;
  const analog = forecastPaths.get(selectedSymbol)?.[String(selectedForecastYears)]?.[selectedForecastView];
  const analogText = analog ? ` The line replays monthly closes from ${analog.analog_start} to ${analog.analog_end}, rescaled to the selected endpoint.` : "";
  byId("forecast-method").textContent = `${scenario.window_count} overlapping historical ${selectedForecastYears}-year windows determine the endpoint.${analogText} The future path is illustrative, not a prediction or executable quote. The dollar amounts are adjusted-price equivalents, not future quoted share prices. Trading costs and taxes are not included.`;
}

function renderStock() {
  const stock = market.symbols[selectedSymbol];
  byId("provider-quote").hidden = false;
  byId("provider-symbol").textContent = selectedSymbol;
  byId("provider-price").textContent = "—";
  byId("provider-change").textContent = "—";
  byId("provider-status").textContent = "Checking latest quote…";
  byId("stock-title").textContent = selectedSymbol;
  byId("stock-dates").textContent = `History from ${stock.first_date} to ${stock.last_date}`;
  byId("stock-price").textContent = money(stock.last_close);
  const change = byId("stock-change");
  change.textContent = `${percent(stock.daily_change)} versus prior close`;
  change.className = `quote-change ${stock.daily_change >= 0 ? "positive" : "negative"}`;
  byId("fact-first").textContent = stock.first_date;
  byId("fact-last").textContent = stock.last_date;
  byId("fact-low").textContent = money(stock.year_low);
  byId("fact-high").textContent = money(stock.year_high);
  renderForecast(stock);
  if (selectedView === "intraday") renderIntradayChart();
  else renderChart(stock);
  if (!forecastPaths.has(selectedSymbol)) {
    const symbol = selectedSymbol;
    byId("forecast-limit").textContent = `Loading illustrative paths for ${symbol}…`;
    ensureForecastPaths(symbol, stock).then(() => {
      if (selectedSymbol !== symbol || selectedMarketKind !== "stock") return;
      renderForecast(stock);
      if (selectedView === "history") renderChart(stock);
    }).catch(error => {
      if (selectedSymbol === symbol) byId("forecast-limit").textContent = `Unable to load candle paths: ${error.message}`;
    });
  }
  refreshProviderQuote();
}

document.addEventListener("DOMContentLoaded", async () => {
  const status = byId("market-status");
  try {
    const response = await fetch("data/market.json");
    if (!response.ok) throw new Error(`Could not load market snapshot (${response.status})`);
    market = await response.json();
    const symbols = Object.keys(market.symbols);
    if (!symbols.length) throw new Error("The market snapshot has no symbols.");
    byId("snapshot-date").textContent = market.as_of;
    byId("hero-symbol-count").textContent = String(symbols.length);
    byId("list-symbol-count").textContent = String(symbols.length + OTHER_MARKETS.length);
    const params = new URLSearchParams(window.location.search);
    const requestedSymbol = params.get("symbol")?.toUpperCase();
    selectedSymbol = market.symbols[requestedSymbol] ? requestedSymbol : symbols[0];
    const requestedAsset = params.get("asset")?.toUpperCase();
    const validAsset = OTHER_MARKETS.some(item => item.id === requestedAsset);
    if (validAsset) selectedAsset = requestedAsset;
    selectedMarketKind = market.symbols[requestedSymbol] && !validAsset ? "stock" : "asset";
    byId("symbol-search").addEventListener("input", renderList);
    for (const button of document.querySelectorAll("[data-view]")) {
      button.addEventListener("click", () => setChartView(button.dataset.view));
    }
    for (const button of document.querySelectorAll("[data-detail-range]")) {
      button.addEventListener("click", () => {
        selectedDetailRange = button.dataset.detailRange;
        for (const item of document.querySelectorAll("[data-detail-range]")) {
          item.classList.toggle("active", item === button);
        }
        renderChart(market.symbols[selectedSymbol]);
      });
    }
    for (const button of document.querySelectorAll("[data-extended-range]")) {
      button.addEventListener("click", () => {
        selectedExtendedRange = button.dataset.extendedRange;
        for (const item of document.querySelectorAll("[data-extended-range]")) {
          item.classList.toggle("active", item === button);
        }
        renderChart(market.symbols[selectedSymbol]);
      });
    }
    byId("forecast-years").addEventListener("change", () => {
      const years = Number(byId("forecast-years").value);
      const stock = market.symbols[selectedSymbol];
      const maximum = maxForecastYears(stock);
      if (!Number.isInteger(years) || years < 1 || years > maximum) {
        byId("forecast-years").value = String(selectedForecastYears);
        byId("forecast-limit").textContent = `Enter a whole number from 1 to ${maximum}.`;
        return;
      }
      selectedForecastYears = years;
      renderForecast(stock);
      if (selectedView === "history") renderChart(stock);
    });
    byId("forecast-view").addEventListener("change", () => {
      selectedForecastView = byId("forecast-view").value;
      renderForecast(market.symbols[selectedSymbol]);
      if (selectedView === "history") renderChart(market.symbols[selectedSymbol]);
    });
    byId("forecast-scale").addEventListener("change", () => {
      selectedForecastScale = byId("forecast-scale").value;
      if (selectedView === "history") renderChart(market.symbols[selectedSymbol]);
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (selectedMarketKind === "stock") renderStock();
      else renderAsset();
    });
    window.setInterval(() => {
      if (selectedMarketKind === "stock") refreshProviderQuote();
    }, 60000);
    renderList();
    if (selectedMarketKind === "stock") {
      showMarket("stock");
      renderStock();
      if (params.get("view") === "intraday") setChartView("intraday");
    } else {
      showMarket("asset");
      renderAsset();
    }
    status.textContent = `${symbols.length} symbols · adjusted daily closes through ${market.as_of}.`;
  } catch (error) {
    status.textContent = `Unable to display market data: ${error.message}`;
    status.classList.add("error");
  }
});
