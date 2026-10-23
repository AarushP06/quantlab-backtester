let market;
let selectedSymbol;
let selectedDetailRange = "1Y";
let selectedView = "history";
let selectedAsset = "GOLD";
let selectedMarketKind = "asset";
let selectedFilter = "all";
let stocksExpanded = false;
let historyDetailChart;
const VISIBLE_STOCKS = 10;
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
  {id: "GOLD", code: "XAU", label: "Gold", title: "Gold spot / US dollar", type: "Spot metal quote · 1-minute candles", symbol: "OANDA:XAUUSD"},
  {id: "BTC", code: "BTC", label: "Bitcoin", title: "Bitcoin / US dollar", type: "Bitstamp spot market · 1-minute candles", symbol: "BITSTAMP:BTCUSD"}
];
const PERIOD_LABELS = {"5D": "past 5 days", "1M": "past month", "6M": "past 6 months", YTD: "year to date", "1Y": "past year", "5Y": "past 5 years"};

const byId = id => document.getElementById(id);
const dollars = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});
const plain = new Intl.NumberFormat("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const ranges = {"1M": 1, "6M": 6, "1Y": 12, "2Y": 24, "3Y": 36, "4Y": 48, "5Y": 60, "10Y": 120};
const signedMoney = value => Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${dollars.format(Math.abs(value))}` : "—";

function money(value) { return Number.isFinite(value) ? dollars.format(value) : "—"; }
function percent(value) { return Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(2)}%` : "—"; }
function displayDate(iso, options = {day: "numeric", month: "short", year: "numeric"}) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(options.day ? "en-GB" : "en-US", {...options, timeZone: "UTC"});
}

function setProviderUnavailable(message) {
  byId("provider-price").textContent = "Unavailable right now";
  byId("provider-change").textContent = "";
  byId("provider-status").textContent = message;
}

function paintProviderQuote(quote) {
  if (selectedSymbol !== quote.symbol) return;
  if (!Number.isFinite(quote.price) || quote.price <= 0) {
    setProviderUnavailable("No valid quote was returned.");
    return;
  }
  byId("provider-price").textContent = money(quote.price);
  const change = byId("provider-change");
  change.textContent = `${quote.change >= 0 ? "+" : ""}${money(quote.change)} (${percent(quote.change_percent / 100)})`;
  change.className = `mono ${quote.change >= 0 ? "positive" : "negative"}`;
  const quoteDate = quote.quote_time || quote.fetched_at;
  const label = quote.quote_time ? "Quote time" : "Checked";
  const formatted = new Date(quoteDate).toLocaleString("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short"
  });
  byId("provider-status").textContent = `${label}: ${formatted}.`;
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
  try {
    const response = await fetch(`${QUOTE_API_BASE}${encodeURIComponent(symbol)}`, {cache: "no-store"});
    if (!response.ok) throw new Error(`Quote service returned ${response.status}`);
    const quote = await response.json();
    if (quote.symbol !== symbol) throw new Error("Quote symbol mismatch");
    providerQuotes.set(symbol, {quote, loadedAt: Date.now()});
    paintProviderQuote(quote);
  } catch (_error) {
    if (selectedSymbol === symbol && !providerQuotes.has(symbol)) {
      setProviderUnavailable("The quote service could not be reached.");
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

function rangeFirstIndex(stock, range) {
  if (range === "5D") return Math.max(stock.dates.length - 6, 0);
  const start = range === "YTD" ? `${stock.last_date.slice(0, 4)}-01-01` : rangeStart(stock.last_date, range);
  const index = stock.dates.findIndex(date => date >= start);
  return Math.max(index, 0);
}

function withAlpha(color, alpha) {
  const hex = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return color;
  const [r, g, b] = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function setSigned(id, text, value) {
  const element = byId(id);
  element.textContent = text;
  element.classList.toggle("positive", value > 0);
  element.classList.toggle("negative", value < 0);
}

function historyDateLabel(value, range) {
  const options = ["5D", "1M"].includes(range)
    ? {month: "short", day: "numeric", timeZone: "UTC"}
    : {year: "numeric", month: "short", timeZone: "UTC"};
  return new Date(Number(value)).toLocaleDateString("en-US", options);
}

function chartColor(variable) {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

function renderChart(stock) {
  if (!window.Chart) throw new Error("Chart.js did not load from the CDN.");
  const first = rangeFirstIndex(stock, selectedDetailRange);
  const dates = stock.dates.slice(first);
  const values = stock.adjusted_close.slice(first);
  const detailFirstDate = Date.parse(`${dates[0]}T00:00:00Z`);
  const lastDate = Date.parse(`${stock.last_date}T00:00:00Z`);
  const rangeReturn = values[values.length - 1] / values[0] - 1;
  const label = selectedDetailRange === "ALL" ? "All-time" : selectedDetailRange;
  byId("stat-range-label").textContent = `${label} return`;
  setSigned("stat-range-return", percent(rangeReturn), rangeReturn);
  byId("stat-range-from").textContent = `From ${money(values[0])}`;
  setSigned("period-change", percent(rangeReturn), rangeReturn);
  byId("period-label").textContent = PERIOD_LABELS[selectedDetailRange] || `since ${displayDate(dates[0], {month: "short", year: "numeric"})}`;
  byId("detail-history-caption").textContent = `Saved snapshot · ${displayDate(dates[0])} to ${displayDate(stock.last_date)} · ${signedMoney(values[values.length - 1] - values[0])} over this range`;
  const lineColor = chartColor("--accent");
  const surface = chartColor("--surface");
  const muted = chartColor("--muted");
  const latestPlugin = {
    id: "latestClose",
    afterDatasetsDraw(chart) {
      const {ctx, chartArea, scales: {x, y}} = chart;
      const lastValue = values[values.length - 1];
      const lastX = x.getPixelForValue(lastDate);
      const lastY = y.getPixelForValue(lastValue);
      ctx.save();
      const active = chart.tooltip?.getActiveElements?.() || [];
      if (active.length) {
        ctx.strokeStyle = muted;
        ctx.globalAlpha = .45;
        ctx.beginPath();
        ctx.moveTo(active[0].element.x, chartArea.top);
        ctx.lineTo(active[0].element.x, chartArea.bottom);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = lineColor;
      ctx.strokeStyle = surface;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const tag = plain.format(lastValue);
      ctx.font = "400 10px 'IBM Plex Mono', ui-monospace, monospace";
      const width = ctx.measureText(tag).width + 14;
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.roundRect(chartArea.right + 6, lastY - 11.5, width, 23, 4);
      ctx.fill();
      ctx.fillStyle = chartColor("--on-accent");
      ctx.textBaseline = "middle";
      ctx.fillText(tag, chartArea.right + 13, lastY + .5);
      ctx.restore();
    }
  };
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low) * .08 || high * .02;
  if (historyDetailChart) historyDetailChart.destroy();
  historyDetailChart = new Chart(byId("history-detail-canvas"), {
    type: "line",
    data: {datasets: [{
      label: `${selectedSymbol} saved adjusted close`,
      data: dates.map((date, index) => ({x: Date.parse(`${date}T00:00:00Z`), y: values[index]})),
      borderColor: lineColor, fill: "start",
      backgroundColor: context => {
        const {ctx, chartArea} = context.chart;
        if (!chartArea) return "transparent";
        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, withAlpha(lineColor, .1));
        gradient.addColorStop(1, withAlpha(lineColor, 0));
        return gradient;
      },
      borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: lineColor,
      pointHoverBorderColor: surface, pointHoverBorderWidth: 2, tension: 0
    }]},
    plugins: [latestPlugin],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      layout: {padding: {top: 8}},
      interaction: {mode: "nearest", axis: "x", intersect: false},
      plugins: {legend: {display: false}, tooltip: {
        displayColors: false, backgroundColor: surface, borderColor: chartColor("--border"), borderWidth: 1,
        titleColor: muted, bodyColor: chartColor("--text"), padding: 10, cornerRadius: 6,
        titleFont: {family: "Inter", weight: "400", size: 11}, bodyFont: {family: "IBM Plex Mono", weight: "400", size: 12},
        callbacks: {
          title: items => new Date(items[0].parsed.x).toLocaleDateString("en-GB", {year: "numeric", month: "short", day: "numeric", timeZone: "UTC"}),
          label: item => `${money(item.parsed.y)}  ${percent(item.parsed.y / values[0] - 1)}`
        }
      }},
      scales: {
        x: {type: "linear", min: detailFirstDate, max: lastDate,
          ticks: {color: muted, font: {family: "Inter", size: 10}, maxTicksLimit: 6, maxRotation: 0, padding: 10,
            callback: value => historyDateLabel(value, selectedDetailRange)},
          grid: {display: false}, border: {display: false}},
        y: {type: "linear", position: "right", min: low - pad, max: high + pad, beginAtZero: false,
          ticks: {color: muted, font: {family: "IBM Plex Mono", size: 10}, maxTicksLimit: 8, padding: 20, includeBounds: false,
            callback: value => plain.format(Number(value))},
          grid: {color: chartColor("--grid")}, border: {display: false},
          afterFit: axis => { axis.width = Math.max(axis.width, 84); }}
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
  byId("asset-monogram").textContent = asset.label[0];
  byId("asset-type").textContent = asset.type;
  byId("asset-title").textContent = asset.title;
  byId("asset-symbol").textContent = `${asset.code}   /   ${asset.symbol}   /   USD`;
  byId("asset-full-chart").href = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(asset.symbol)}`;
  byId("asset-chart").setAttribute("aria-label", `One-minute chart for ${asset.title}`);
  mountTradingView(byId("asset-chart"), asset.symbol);
}

function syncSelection() {
  for (const row of document.querySelectorAll("[data-symbol], [data-asset]")) {
    const active = row.dataset.asset
      ? selectedMarketKind === "asset" && row.dataset.asset === selectedAsset
      : selectedMarketKind === "stock" && row.dataset.symbol === selectedSymbol;
    row.setAttribute("aria-pressed", String(active));
  }
}

function showMarket(kind) {
  selectedMarketKind = kind;
  byId("asset-main").hidden = kind !== "asset";
  byId("stock-main").hidden = kind !== "stock";
  if (kind === "stock") byId("asset-chart").replaceChildren();
  else byId("intraday-chart").replaceChildren();
  const asset = OTHER_MARKETS.find(item => item.id === selectedAsset);
  byId("market-picker-current").textContent = kind === "asset"
    ? `${asset.code} · ${asset.label}`
    : `${selectedSymbol} · ${money(market.symbols[selectedSymbol].last_close)}`;
  syncSelection();
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
  byId("chart-kicker").textContent = view === "intraday"
    ? "1-minute candles · TradingView" : "Adjusted close · USD";
  byId("intraday-chart").hidden = view !== "intraday";
  byId("history-detail-chart").hidden = view !== "history";
  byId("range-row").hidden = view !== "history";
  byId("history-provenance").hidden = view !== "history";
  if (view === "intraday") renderIntradayChart();
  else renderChart(market.symbols[selectedSymbol]);
}

function closePicker() {
  byId("market-picker-panel").hidden = true;
  byId("market-picker-toggle").setAttribute("aria-expanded", "false");
}

function selectMarket(param, value) {
  const url = new URL(window.location.href);
  url.searchParams.set(param, value);
  url.searchParams.delete(param === "asset" ? "symbol" : "asset");
  history.replaceState(null, "", url);
}

function textSpan(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function stockRow(symbol, stock) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "market-row";
  row.dataset.symbol = symbol;
  const identity = document.createElement("span");
  identity.append(textSpan("symbol", symbol), textSpan("name", shortName(symbol)));
  const values = document.createElement("span");
  values.className = "values";
  values.append(textSpan("price", plain.format(stock.last_close)),
    textSpan(`change ${stock.daily_change >= 0 ? "positive" : "negative"}`, percent(stock.daily_change)));
  row.append(identity, values);
  row.addEventListener("click", () => {
    selectedSymbol = symbol;
    selectMarket("symbol", symbol);
    showMarket("stock");
    renderStock();
    closePicker();
  });
  return row;
}

function assetRow(asset) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "other-row";
  row.dataset.asset = asset.id;
  row.append(textSpan("symbol", asset.code), textSpan("name", asset.label), textSpan("tag", "Chart only"));
  row.addEventListener("click", () => {
    selectedAsset = asset.id;
    selectMarket("asset", asset.id);
    showMarket("asset");
    renderAsset();
    closePicker();
  });
  return row;
}

function renderList() {
  const query = byId("symbol-search").value.trim().toUpperCase();
  const matches = terms => !query || terms.some(term => term.toUpperCase().includes(query));
  const stocks = Object.keys(market.symbols).filter(symbol => matches([symbol, shortName(symbol), fullName(symbol)]));
  const assets = OTHER_MARKETS.filter(asset => matches([asset.id, asset.code, asset.label, asset.title]));
  const showStocks = selectedFilter !== "other" && stocks.length > 0;
  const showAssets = selectedFilter !== "stocks" && assets.length > 0;
  byId("stock-section").hidden = !showStocks;
  byId("other-section").hidden = !showAssets;
  byId("list-empty").hidden = showStocks || showAssets;

  const collapsible = !query && stocks.length > VISIBLE_STOCKS;
  const visible = collapsible && !stocksExpanded ? stocks.slice(0, VISIBLE_STOCKS) : stocks;
  byId("symbol-list").replaceChildren(...visible.map(symbol => stockRow(symbol, market.symbols[symbol])));
  byId("other-list").replaceChildren(...assets.map(assetRow));
  const more = byId("browse-more");
  more.hidden = !collapsible;
  more.setAttribute("aria-expanded", String(stocksExpanded));
  byId("browse-more-label").textContent = stocksExpanded
    ? "Show fewer stocks" : `Show ${stocks.length - VISIBLE_STOCKS} more stocks`;
  syncSelection();
}

function renderStock() {
  const stock = market.symbols[selectedSymbol];
  const tradingViewSymbol = TRADINGVIEW_SYMBOLS[selectedSymbol];
  const exchange = tradingViewSymbol ? tradingViewSymbol.split(":")[0] : "US";
  byId("provider-symbol").textContent = selectedSymbol;
  byId("provider-price").textContent = "Checking latest quote…";
  byId("provider-change").textContent = "";
  byId("provider-status").textContent = "";
  byId("stock-monogram").textContent = shortName(selectedSymbol)[0];
  byId("stock-title").textContent = fullName(selectedSymbol);
  byId("stock-listing").textContent = `${selectedSymbol}   /   ${exchange}   /   USD`;
  byId("open-forecast").href = `forecast.html?symbol=${encodeURIComponent(selectedSymbol)}`;
  byId("stock-price").textContent = money(stock.last_close);
  const previousClose = stock.last_close / (1 + stock.daily_change);
  const dayChange = stock.last_close - previousClose;
  const change = byId("stock-change");
  change.textContent = `${signedMoney(dayChange)}  (${percent(stock.daily_change)})`;
  change.className = `quote-change mono ${stock.daily_change >= 0 ? "positive" : "negative"}`;
  byId("quote-date").textContent = `${displayDate(stock.last_date)} · Close`;
  byId("stat-prev").textContent = money(previousClose);
  byId("stat-prev-date").textContent = stock.dates.length > 1 ? displayDate(stock.dates[stock.dates.length - 2]) : "—";
  setSigned("stat-day", percent(stock.daily_change), dayChange);
  byId("stat-day-detail").textContent = `${signedMoney(dayChange)} vs. previous close`;
  const fiveYearStart = stock.adjusted_close[rangeFirstIndex(stock, "5Y")];
  const fiveYear = stock.last_close / fiveYearStart - 1;
  setSigned("stat-5y", percent(fiveYear), fiveYear);
  byId("stat-5y-from").textContent = `From ${money(fiveYearStart)}`;
  let athIndex = 0;
  stock.adjusted_close.forEach((value, index) => { if (value > stock.adjusted_close[athIndex]) athIndex = index; });
  byId("stat-ath").textContent = money(stock.adjusted_close[athIndex]);
  byId("stat-ath-date").textContent = `Adjusted close · ${displayDate(stock.dates[athIndex], {month: "short", year: "numeric"})}`;
  byId("fact-first").textContent = displayDate(stock.first_date);
  byId("range52-label").textContent = `${money(stock.year_low)} — ${money(stock.year_high)}`;
  const span = stock.year_high - stock.year_low;
  const position = span > 0 ? Math.min(Math.max((stock.last_close - stock.year_low) / span, 0), 1) : .5;
  byId("range52-fill").style.width = `${(position * 100).toFixed(1)}%`;
  byId("range52-marker").style.left = `calc(${(position * 100).toFixed(1)}% - ${(position * 8).toFixed(1)}px)`;
  if (selectedView === "intraday") renderIntradayChart();
  else renderChart(stock);
  refreshProviderQuote();
}

async function loadStudyCount() {
  try {
    const response = await fetch("data/manifest.json");
    if (!response.ok) return;
    const manifest = await response.json();
    if (Number.isFinite(manifest.symbols)) byId("study-count").textContent = String(manifest.symbols);
  } catch (_error) {
    // Keep the default count in the HTML.
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const status = byId("market-status");
  loadStudyCount();
  try {
    const response = await fetch("data/market.json");
    if (!response.ok) throw new Error(`Could not load market snapshot (${response.status})`);
    market = await response.json();
    const symbols = Object.keys(market.symbols);
    if (!symbols.length) throw new Error("The market snapshot has no symbols.");
    byId("snapshot-date").textContent = displayDate(market.as_of);
    const total = symbols.length + OTHER_MARKETS.length;
    byId("list-symbol-count").textContent = String(total);
    byId("filter-count-all").textContent = String(total);
    byId("filter-count-stocks").textContent = String(symbols.length);
    byId("filter-count-other").textContent = String(OTHER_MARKETS.length);
    const params = new URLSearchParams(window.location.search);
    const requestedSymbol = params.get("symbol")?.toUpperCase();
    selectedSymbol = market.symbols[requestedSymbol] ? requestedSymbol : symbols[0];
    stocksExpanded = symbols.indexOf(selectedSymbol) >= VISIBLE_STOCKS;
    const requestedAsset = params.get("asset")?.toUpperCase();
    const validAsset = OTHER_MARKETS.some(item => item.id === requestedAsset);
    if (validAsset) selectedAsset = requestedAsset;
    selectedMarketKind = validAsset ? "asset" : "stock";
    byId("symbol-search").addEventListener("input", renderList);
    byId("browse-more").addEventListener("click", () => {
      stocksExpanded = !stocksExpanded;
      renderList();
    });
    for (const button of document.querySelectorAll("[data-filter]")) {
      button.addEventListener("click", () => {
        selectedFilter = button.dataset.filter;
        for (const item of document.querySelectorAll("[data-filter]")) {
          item.setAttribute("aria-pressed", String(item === button));
        }
        renderList();
      });
    }
    byId("market-picker-toggle").addEventListener("click", () => {
      const panel = byId("market-picker-panel");
      panel.hidden = !panel.hidden;
      byId("market-picker-toggle").setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) byId("symbol-search").focus();
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape") closePicker(); });
    document.addEventListener("click", event => {
      if (!event.target.closest(".market-browser")) closePicker();
    });
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
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (selectedMarketKind === "stock") renderStock();
      else renderAsset();
    });
    window.setInterval(() => {
      if (selectedMarketKind === "stock") refreshProviderQuote();
    }, 60000);
    // Canvas text needs the web fonts before the first chart draw.
    await document.fonts?.ready?.catch(() => {});
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
