let market;
let selectedSymbol;
let selectedRange = "1Y";
let selectedView = "history";
let priceChart;
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

const byId = id => document.getElementById(id);
const dollars = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});
const ranges = {"1M": 1, "6M": 6, "1Y": 12, "5Y": 60};

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

function rangeStart(lastDate) {
  if (selectedRange === "ALL") return "0000-01-01";
  const date = new Date(`${lastDate}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - ranges[selectedRange]);
  return date.toISOString().slice(0, 10);
}

function chartColor(variable) {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

function renderChart(stock) {
  if (!window.Chart) throw new Error("Chart.js did not load from the CDN.");
  const start = rangeStart(stock.last_date);
  const first = stock.dates.findIndex(date => date >= start);
  const dates = stock.dates.slice(Math.max(first, 0));
  const values = stock.adjusted_close.slice(Math.max(first, 0));
  if (priceChart) priceChart.destroy();
  priceChart = new Chart(byId("stock-chart"), {
    type: "line",
    data: {labels: dates, datasets: [{
      label: `${selectedSymbol} adjusted close`, data: values,
      borderColor: chartColor("--accent"), backgroundColor: chartColor("--accent"),
      borderWidth: 2, pointRadius: 0, tension: 0
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: {mode: "index", intersect: false},
      plugins: {
        legend: {display: false},
        tooltip: {callbacks: {label: context => money(context.parsed.y)}}
      },
      scales: {
        x: {ticks: {color: chartColor("--muted"), maxTicksLimit: 7, maxRotation: 0}, grid: {display: false}},
        y: {ticks: {color: chartColor("--muted"), callback: value => money(Number(value))}, grid: {color: chartColor("--grid")}}
      }
    }
  });
}

function renderIntradayChart() {
  const target = byId("intraday-chart");
  target.replaceChildren();
  const symbol = TRADINGVIEW_SYMBOLS[selectedSymbol];
  if (!symbol) {
    target.textContent = "A one-minute chart is not configured for this symbol.";
    return;
  }
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
  byId("chart-kicker").textContent = view === "intraday"
    ? "Intraday market chart · USD" : "Adjusted price history · USD";
  byId("intraday-chart").hidden = view !== "intraday";
  byId("history-chart").hidden = view !== "history";
  document.querySelector(".range-bar").hidden = view !== "history";
  if (view === "intraday") renderIntradayChart();
  else renderChart(market.symbols[selectedSymbol]);
}

function renderList() {
  const query = byId("symbol-search").value.trim().toUpperCase();
  const list = byId("symbol-list");
  list.replaceChildren();
  for (const [symbol, stock] of Object.entries(market.symbols)) {
    if (!symbol.includes(query)) continue;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "symbol-row";
    row.setAttribute("aria-pressed", String(symbol === selectedSymbol));
    const label = document.createElement("span");
    const ticker = document.createElement("span");
    ticker.className = "ticker";
    ticker.textContent = symbol;
    const price = document.createElement("span");
    price.className = "row-price";
    price.textContent = money(stock.last_close);
    label.append(ticker, price);
    const change = document.createElement("span");
    change.className = `row-change ${stock.daily_change >= 0 ? "positive" : "negative"}`;
    change.textContent = percent(stock.daily_change);
    row.append(label, change);
    row.addEventListener("click", () => {
      selectedSymbol = symbol;
      const url = new URL(window.location.href);
      url.searchParams.set("symbol", symbol);
      history.replaceState(null, "", url);
      renderList();
      renderStock();
    });
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
    byId("list-symbol-count").textContent = String(symbols.length);
    selectedSymbol = new URLSearchParams(window.location.search).get("symbol")?.toUpperCase();
    if (!market.symbols[selectedSymbol]) selectedSymbol = symbols[0];
    byId("symbol-search").addEventListener("input", renderList);
    for (const button of document.querySelectorAll("[data-view]")) {
      button.addEventListener("click", () => setChartView(button.dataset.view));
    }
    for (const button of document.querySelectorAll("[data-range]")) {
      button.addEventListener("click", () => {
        selectedRange = button.dataset.range;
        for (const item of document.querySelectorAll("[data-range]")) {
          item.classList.toggle("active", item === button);
        }
        renderStock();
      });
    }
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderStock);
    window.setInterval(() => {
      refreshProviderQuote();
    }, 60000);
    renderList();
    renderStock();
    if (new URLSearchParams(window.location.search).get("view") === "intraday") {
      setChartView("intraday");
    }
    status.textContent = `${symbols.length} symbols · adjusted daily closes through ${market.as_of}.`;
  } catch (error) {
    status.textContent = `Unable to display market data: ${error.message}`;
    status.classList.add("error");
  }
});
