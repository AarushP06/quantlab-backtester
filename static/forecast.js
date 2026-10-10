let market;
let selectedSymbol;
let selectedExtendedRange = "4Y";
let selectedForecastYears = 5;
let selectedForecastView = "moderate";
let selectedForecastScale = "logarithmic";
let priceChart;
const forecastPaths = new Map();
const forecastPending = new Map();
const byId = id => document.getElementById(id);
const dollars = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});
const ranges = {"1Y": 12, "2Y": 24, "3Y": 36, "4Y": 48, "5Y": 60, "10Y": 120};
function money(value) { return Number.isFinite(value) ? dollars.format(value) : "—"; }
function percent(value) { return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%` : "—"; }
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
  byId("extended-history-caption").textContent = `Saved through ${stock.last_date} · future path is illustrative`;
  const scenario = stock.historical_scenarios[String(selectedForecastYears)];
  const analog = forecastPaths.get(selectedSymbol)?.[String(selectedForecastYears)]?.[selectedForecastView];
  const candles = analog?.bars || [];
  const extendedStart = rangeStart(stock.last_date, selectedExtendedRange);
  const extendedFirst = stock.dates.findIndex(date => date >= extendedStart);
  const extendedDates = stock.dates.slice(Math.max(extendedFirst, 0));
  const extendedValues = stock.adjusted_close.slice(Math.max(extendedFirst, 0));
  const firstDate = Date.parse(`${extendedDates[0]}T00:00:00Z`);
  const lastDate = Date.parse(`${stock.last_date}T00:00:00Z`);
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

function renderForecast(stock) {
  const body = byId("forecast-body");
  body.replaceChildren();
  const maximum = maxForecastYears(stock);
  selectedForecastYears = Math.min(selectedForecastYears, maximum);
  byId("forecast-years").max = String(maximum);
  byId("forecast-years").value = String(selectedForecastYears);
  byId("forecast-limit").textContent = `Choose 1–${maximum} whole years for ${selectedSymbol}. The chart reserves space for both history and the illustrative future path. The logarithmic price scale keeps long horizons readable.`;
  byId("forecast-as-of").textContent = `Based on ${stock.last_date} adjusted close: ${money(stock.last_close)}`;
  byId("forecast-title").textContent = `${selectedSymbol} scenario`;
  byId("back-to-market").href = `markets.html?symbol=${encodeURIComponent(selectedSymbol)}`;
  const scenario = stock.historical_scenarios[String(selectedForecastYears)];
  const outcome = scenario.outcomes[selectedForecastView];
  byId("selected-scenario-label").textContent = `${selectedForecastView[0].toUpperCase()}${selectedForecastView.slice(1)} · ${selectedForecastYears} ${selectedForecastYears === 1 ? "year" : "years"} · to ${scenario.through_date}`;
  byId("selected-scenario-price").textContent = money(outcome.adjusted_price);
  byId("selected-scenario-return").textContent = `${percent(outcome.total_return)} total from saved close`;
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


async function showStock() {
  const stock = market.symbols[selectedSymbol];
  const symbol = selectedSymbol;
  byId("forecast-symbol").value = symbol;
  renderForecast(stock);
  byId("forecast-status").textContent = `Loading illustrative path for ${symbol}…`;
  try {
    await ensureForecastPaths(symbol, stock);
    if (selectedSymbol !== symbol) return;
    renderForecast(stock);
    renderChart(stock);
    byId("forecast-status").textContent = `${symbol} · saved adjusted close through ${stock.last_date}.`;
  } catch (error) {
    if (selectedSymbol === symbol) byId("forecast-status").textContent = `Unable to load forecast path: ${error.message}`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const status = byId("forecast-status");
  try {
    const response = await fetch("data/market.json");
    if (!response.ok) throw new Error(`Could not load market snapshot (${response.status})`);
    market = await response.json();
    const symbols = Object.keys(market.symbols);
    if (!symbols.length) throw new Error("The market snapshot has no symbols.");
    for (const symbol of symbols) byId("forecast-symbol").add(new Option(symbol, symbol));
    const requested = new URLSearchParams(window.location.search).get("symbol")?.toUpperCase();
    selectedSymbol = market.symbols[requested] ? requested : symbols[0];
    byId("forecast-symbol").addEventListener("change", () => {
      selectedSymbol = byId("forecast-symbol").value;
      const url = new URL(window.location.href);
      url.searchParams.set("symbol", selectedSymbol);
      history.replaceState(null, "", url);
      showStock();
    });
    byId("forecast-years").addEventListener("change", () => {
      const years = Number(byId("forecast-years").value);
      const maximum = maxForecastYears(market.symbols[selectedSymbol]);
      if (!Number.isInteger(years) || years < 1 || years > maximum) {
        byId("forecast-years").value = String(selectedForecastYears);
        byId("forecast-limit").textContent = `Enter a whole number from 1 to ${maximum}.`;
        return;
      }
      selectedForecastYears = years;
      renderForecast(market.symbols[selectedSymbol]);
      renderChart(market.symbols[selectedSymbol]);
    });
    byId("forecast-view").addEventListener("change", () => {
      selectedForecastView = byId("forecast-view").value;
      renderForecast(market.symbols[selectedSymbol]);
      renderChart(market.symbols[selectedSymbol]);
    });
    byId("forecast-scale").addEventListener("change", () => {
      selectedForecastScale = byId("forecast-scale").value;
      renderChart(market.symbols[selectedSymbol]);
    });
    for (const button of document.querySelectorAll("[data-extended-range]")) button.addEventListener("click", () => {
      selectedExtendedRange = button.dataset.extendedRange;
      for (const item of document.querySelectorAll("[data-extended-range]")) item.classList.toggle("active", item === button);
      renderChart(market.symbols[selectedSymbol]);
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderChart(market.symbols[selectedSymbol]));
    await showStock();
  } catch (error) {
    status.textContent = `Unable to display forecast data: ${error.message}`;
    status.classList.add("error");
  }
});
