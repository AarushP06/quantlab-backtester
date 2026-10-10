let market;
let selectedSymbol;
let selectedDetailRange = "4Y";
let selectedView = "history";
let selectedAsset = "GOLD";
let selectedMarketKind = "asset";
let historyDetailChart;
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

function renderChart(stock) {
  if (!window.Chart) throw new Error("Chart.js did not load from the CDN.");
  byId("detail-history-caption").textContent = `Close-up through ${stock.last_date} · own price scale`;
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
        y: {type: "linear", ticks: {color: chartColor("--muted"), maxTicksLimit: 5,
          callback: value => money(Number(value))}, grid: {color: chartColor("--grid")}}
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
  byId("market-picker-current").textContent = kind === "asset"
    ? OTHER_MARKETS.find(item => item.id === selectedAsset).label
    : `${selectedSymbol} · ${money(market.symbols[selectedSymbol].last_close)}`;
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
  byId("history-detail-chart").hidden = view !== "history";
  for (const heading of document.querySelectorAll(".chart-panel-heading")) heading.hidden = view !== "history";
  for (const bar of document.querySelectorAll(".range-bar")) bar.hidden = view !== "history";
  if (view === "intraday") renderIntradayChart();
  else renderChart(market.symbols[selectedSymbol]);
}

function closePicker() {
  byId("market-picker-panel").hidden = true;
  byId("market-picker-toggle").setAttribute("aria-expanded", "false");
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
        closePicker();
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
        closePicker();
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

function renderStock() {
  const stock = market.symbols[selectedSymbol];
  byId("provider-quote").hidden = false;
  byId("provider-symbol").textContent = selectedSymbol;
  byId("provider-price").textContent = "—";
  byId("provider-change").textContent = "—";
  byId("provider-status").textContent = "Checking latest quote…";
  byId("stock-title").textContent = selectedSymbol;
  byId("open-forecast").href = `forecast.html?symbol=${encodeURIComponent(selectedSymbol)}`;
  byId("stock-dates").textContent = `History from ${stock.first_date} to ${stock.last_date}`;
  byId("stock-price").textContent = money(stock.last_close);
  const change = byId("stock-change");
  change.textContent = `${percent(stock.daily_change)} versus prior close`;
  change.className = `quote-change ${stock.daily_change >= 0 ? "positive" : "negative"}`;
  byId("fact-first").textContent = stock.first_date;
  byId("fact-last").textContent = stock.last_date;
  byId("fact-low").textContent = money(stock.year_low);
  byId("fact-high").textContent = money(stock.year_high);
  if (selectedView === "intraday") renderIntradayChart();
  else renderChart(stock);
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
    byId("market-picker-toggle").addEventListener("click", () => {
      const panel = byId("market-picker-panel");
      panel.hidden = !panel.hidden;
      byId("market-picker-toggle").setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) byId("symbol-search").focus();
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape") closePicker(); });
    document.addEventListener("click", event => {
      if (!event.target.closest(".asset-sidebar")) closePicker();
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
