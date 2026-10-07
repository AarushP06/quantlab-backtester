let market;
let selectedSymbol;
let selectedRange = "1Y";
let selectedView = "history";
let priceChart;
const providerQuotes = new Map();
const quotePending = new Set();
const providerCandles = new Map();
const candlePending = new Set();
const QUOTE_API_BASE = "https://quantlab-backtester.onrender.com/api/quote/";
const CANDLE_API_BASE = "https://quantlab-backtester.onrender.com/api/candles/";

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

function newYorkTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit"
  });
}

const candlePainter = {
  id: "candlePainter",
  afterDatasetsDraw(chart) {
    if (!chart.$candles) return;
    const {ctx, scales, chartArea} = chart;
    const bars = chart.$candles;
    const width = Math.max(2, Math.min(10, chartArea.width / bars.length * 0.65));
    ctx.save();
    for (let index = 0; index < bars.length; index++) {
      const bar = bars[index];
      const x = scales.x.getPixelForValue(index);
      const high = scales.y.getPixelForValue(bar.high);
      const low = scales.y.getPixelForValue(bar.low);
      const open = scales.y.getPixelForValue(bar.open);
      const close = scales.y.getPixelForValue(bar.close);
      ctx.fillStyle = ctx.strokeStyle = bar.close >= bar.open ? "#16875e" : "#c55350";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x, high);
      ctx.lineTo(x, low);
      ctx.stroke();
      ctx.fillRect(x - width / 2, Math.min(open, close), width, Math.max(1.5, Math.abs(close - open)));
    }
    ctx.restore();
  }
};

function renderCandles(payload) {
  const candles = payload.candles;
  if (!window.Chart) throw new Error("Chart.js did not load from the CDN.");
  if (priceChart) priceChart.destroy();
  const lows = candles.map(candle => candle.low);
  const highs = candles.map(candle => candle.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const padding = Math.max((max - min) * 0.08, max * 0.0005);
  priceChart = new Chart(byId("stock-chart"), {
    type: "line",
    data: {
      labels: candles.map(candle => newYorkTime(candle.time)),
      datasets: [{data: candles.map(candle => candle.close), borderWidth: 0, pointRadius: 0,
        pointHitRadius: 10, showLine: false}]
    },
    plugins: [candlePainter],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: {mode: "index", intersect: false},
      plugins: {
        legend: {display: false},
        tooltip: {callbacks: {label: context => {
          const bar = candles[context.dataIndex];
          return `O ${money(bar.open)}  H ${money(bar.high)}  L ${money(bar.low)}  C ${money(bar.close)}`;
        }}}
      },
      scales: {
        x: {ticks: {color: chartColor("--muted"), maxTicksLimit: 7, maxRotation: 0}, grid: {display: false}},
        y: {min: min - padding, max: max + padding,
          ticks: {color: chartColor("--muted"), callback: value => money(Number(value))},
          grid: {color: chartColor("--grid")}}
      }
    }
  });
  priceChart.$candles = candles;
  priceChart.update("none");
}

function paintCandles(payload) {
  if (selectedView !== "intraday" || selectedSymbol !== payload.symbol) return;
  renderCandles(payload);
  const last = new Date(payload.latest_bar_time).toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short"
  });
  const ageMinutes = Math.floor((Date.now() - new Date(payload.latest_bar_time).getTime()) / 60000);
  const delay = ageMinutes > 2 ? ` · last bar ${ageMinutes} minutes ago` : "";
  const status = byId("candle-status");
  status.textContent = `Latest available session ${payload.session_date} · 1-minute bars through ${last}${delay} · checks every minute while open`;
  status.classList.remove("error");
}

async function refreshCandles() {
  if (selectedView !== "intraday" || document.hidden) return;
  const symbol = selectedSymbol;
  if (candlePending.has(symbol)) return;
  const cached = providerCandles.get(symbol);
  if (cached && Date.now() - cached.loadedAt < 60000) {
    paintCandles(cached.payload);
    return;
  }
  candlePending.add(symbol);
  byId("candle-status").textContent = "Loading the latest available minute candles…";
  try {
    const response = await fetch(`${CANDLE_API_BASE}${encodeURIComponent(symbol)}`, {cache: "no-store"});
    if (!response.ok) throw new Error(`Candle service returned ${response.status}`);
    const payload = await response.json();
    if (payload.symbol !== symbol || !Array.isArray(payload.candles) || !payload.candles.length) {
      throw new Error("No candle data returned");
    }
    providerCandles.set(symbol, {payload, loadedAt: Date.now()});
    paintCandles(payload);
  } catch (_error) {
    if (selectedView === "intraday" && selectedSymbol === symbol) {
      if (priceChart) { priceChart.destroy(); priceChart = null; }
      byId("candle-status").textContent = "Minute candles are unavailable from the current provider plan or feed. The historical chart remains available.";
      byId("candle-status").classList.add("error");
    }
  } finally {
    candlePending.delete(symbol);
  }
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
  if (selectedView === "intraday") {
    if (priceChart) { priceChart.destroy(); priceChart = null; }
    refreshCandles();
  } else {
    renderChart(stock);
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
    byId("list-symbol-count").textContent = String(symbols.length);
    selectedSymbol = new URLSearchParams(window.location.search).get("symbol")?.toUpperCase();
    if (!market.symbols[selectedSymbol]) selectedSymbol = symbols[0];
    byId("symbol-search").addEventListener("input", renderList);
    for (const button of document.querySelectorAll("[data-view]")) {
      button.addEventListener("click", () => {
        selectedView = button.dataset.view;
        for (const item of document.querySelectorAll("[data-view]")) {
          item.classList.toggle("active", item === button);
          item.setAttribute("aria-pressed", String(item === button));
        }
        byId("candle-status").hidden = selectedView !== "intraday";
        document.querySelector(".range-bar").hidden = selectedView === "intraday";
        byId("stock-chart").setAttribute("aria-label", selectedView === "intraday"
          ? "Latest available one-minute candlestick chart" : "Historical adjusted close chart");
        renderStock();
      });
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
      refreshCandles();
    }, 60000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) { refreshProviderQuote(); refreshCandles(); }
    });
    renderList();
    renderStock();
    status.textContent = `${symbols.length} symbols · adjusted daily closes through ${market.as_of}.`;
  } catch (error) {
    status.textContent = `Unable to display market data: ${error.message}`;
    status.classList.add("error");
  }
});
