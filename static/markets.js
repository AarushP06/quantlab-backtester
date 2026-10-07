let market;
let selectedSymbol;
let selectedRange = "1Y";
let priceChart;
let providerQuote;
let quoteLoadedAt = 0;
let quotePending = false;
const QUOTE_API_URL = "https://quantlab-backtester.onrender.com/api/quote/GOOGL";

const byId = id => document.getElementById(id);
const dollars = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});
const ranges = {"1M": 1, "6M": 6, "1Y": 12, "5Y": 60};

function money(value) { return Number.isFinite(value) ? dollars.format(value) : "—"; }
function percent(value) { return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%` : "—"; }

function paintProviderQuote() {
  if (!providerQuote || selectedSymbol !== "GOOGL") return;
  byId("provider-price").textContent = money(providerQuote.price);
  const change = byId("provider-change");
  change.textContent = `${providerQuote.change >= 0 ? "+" : ""}${money(providerQuote.change)} (${percent(providerQuote.change_percent / 100)})`;
  change.className = `provider-change ${providerQuote.change >= 0 ? "positive" : "negative"}`;
  const quoteDate = providerQuote.quote_time || providerQuote.fetched_at;
  const label = providerQuote.quote_time ? "Quote time" : "Checked";
  const formatted = new Date(quoteDate).toLocaleString("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short"
  });
  byId("provider-status").textContent = `${label}: ${formatted}`;
}

async function refreshProviderQuote() {
  if (selectedSymbol !== "GOOGL" || quotePending) return;
  if (providerQuote && Date.now() - quoteLoadedAt < 60000) {
    paintProviderQuote();
    return;
  }
  quotePending = true;
  byId("provider-status").textContent = "Checking latest quote…";
  try {
    const response = await fetch(QUOTE_API_URL, {cache: "no-store"});
    if (!response.ok) throw new Error(`Quote service returned ${response.status}`);
    providerQuote = await response.json();
    quoteLoadedAt = Date.now();
    paintProviderQuote();
  } catch (_error) {
    if (selectedSymbol === "GOOGL") {
      byId("provider-price").textContent = "—";
      byId("provider-change").textContent = "—";
      byId("provider-status").textContent = "Latest quote unavailable. Saved history remains available.";
    }
  } finally {
    quotePending = false;
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
  byId("provider-quote").hidden = selectedSymbol !== "GOOGL";
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
  renderChart(stock);
  if (selectedSymbol === "GOOGL") refreshProviderQuote();
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
    selectedSymbol = new URLSearchParams(window.location.search).get("symbol")?.toUpperCase();
    if (!market.symbols[selectedSymbol]) selectedSymbol = symbols[0];
    byId("symbol-search").addEventListener("input", renderList);
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
      if (selectedSymbol === "GOOGL") refreshProviderQuote();
    }, 60000);
    renderList();
    renderStock();
    status.textContent = `${symbols.length} symbols · adjusted daily closes through ${market.as_of}.`;
  } catch (error) {
    status.textContent = `Unable to display market data: ${error.message}`;
    status.classList.add("error");
  }
});
