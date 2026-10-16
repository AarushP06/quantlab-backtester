let market;
let selectedSymbol;
let selectedExtendedRange = "10Y";
let selectedForecastYears = 5;
let selectedForecastView = "moderate";
let selectedForecastScale = "logarithmic";
let priceChart;
const forecastPaths = new Map();
const forecastPending = new Map();
const byId = id => document.getElementById(id);
const dollars = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});
const ranges = {"1Y": 12, "2Y": 24, "3Y": 36, "4Y": 48, "5Y": 60, "10Y": 120, "15Y": 180, "20Y": 240};
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

function withAlpha(color, alpha) {
  const hex = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return color;
  const [r, g, b] = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

// Replays the analog window's daily closes, pinned to every monthly close and the final endpoint,
// so the illustrative path has the same day-to-day texture as the historical line.
function dailyAnalogPoints(stock, analog, candles, futureX, lastDate) {
  if (!analog?.analog_start || !candles.length) return null;
  const lastIndexByMonth = new Map();
  stock.dates.forEach((date, index) => lastIndexByMonth.set(date.slice(0, 7), index));
  const [startYear, startMonth] = analog.analog_start.split("-").map(Number);
  const monthKey = offset => {
    const date = new Date(Date.UTC(startYear, startMonth - 1 + offset, 1));
    return date.toISOString().slice(0, 7);
  };
  const anchors = [];
  for (let k = 0; k <= candles.length; k += 1) {
    const index = lastIndexByMonth.get(monthKey(k));
    if (index === undefined || (anchors.length && index <= anchors[anchors.length - 1])) return null;
    anchors.push(index);
  }
  const closes = stock.adjusted_close;
  const points = [{x: futureX(lastDate), y: stock.last_close}];
  let previousPrice = stock.last_close;
  let previousDate = lastDate;
  for (let k = 1; k <= candles.length; k += 1) {
    const from = anchors[k - 1];
    const to = anchors[k];
    const target = candles[k - 1][4];
    const segmentDate = Date.parse(`${candles[k - 1][0]}T00:00:00Z`);
    const rawEnd = closes[to] / closes[from];
    const correction = target / (previousPrice * rawEnd);
    for (let j = from + 1; j <= to; j += 1) {
      const fraction = (j - from) / (to - from);
      const value = j === to ? target : previousPrice * (closes[j] / closes[from]) * correction ** fraction;
      points.push({x: futureX(previousDate + fraction * (segmentDate - previousDate)), y: value});
    }
    previousPrice = target;
    previousDate = segmentDate;
  }
  return points;
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
  const split = {"1Y": .48, "2Y": .52, "3Y": .54, "4Y": .56, "5Y": .6, "10Y": .66, "15Y": .7, "20Y": .72, "ALL": .72}[selectedExtendedRange];
  const endDate = Date.parse(`${scenario.through_date}T00:00:00Z`);
  const historyX = date => split * (date - firstDate) / (lastDate - firstDate);
  const futureX = date => split + (1 - split) * (date - lastDate) / (endDate - lastDate);
  const dateAtX = x => x <= split
    ? firstDate + x / split * (lastDate - firstDate)
    : lastDate + (x - split) / (1 - split) * (endDate - lastDate);
  // Yahoo Finance style: line colored by direction over the shown range, soft gradient area underneath.
  const historyUp = extendedValues[extendedValues.length - 1] >= extendedValues[0];
  const historyColor = chartColor(historyUp ? "--gain" : "--loss") || chartColor("--accent");
  const pathColor = chartColor("--forecast-mid");
  const areaFill = (color, strength) => context => {
    const {ctx, chartArea} = context.chart;
    if (!chartArea) return "transparent";
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, withAlpha(color, strength));
    gradient.addColorStop(1, withAlpha(color, 0));
    return gradient;
  };
  const datasets = [{
    label: `${selectedSymbol} history`,
    data: extendedDates.map((date, index) => ({x: historyX(Date.parse(`${date}T00:00:00Z`)), y: extendedValues[index]})),
    borderColor: historyColor, backgroundColor: areaFill(historyColor, .28), fill: "start",
    borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: historyColor,
    pointHoverBorderColor: chartColor("--surface"), pointHoverBorderWidth: 2, tension: 0
  }];
  if (candles.length) {
    datasets.push({
      label: `${selectedForecastView[0].toUpperCase()}${selectedForecastView.slice(1)} illustrative path`,
      data: dailyAnalogPoints(stock, analog, candles, futureX, lastDate) || [{x: split, y: stock.last_close}, ...candles.map(candle => ({
        x: futureX(Date.parse(`${candle[0]}T00:00:00Z`)), y: candle[4]
      }))],
      borderColor: chartColor("--forecast-mid"), backgroundColor: chartColor("--forecast-mid"),
      fill: false, borderDash: [6, 4],
      borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: pathColor,
      pointHoverBorderColor: chartColor("--surface"), pointHoverBorderWidth: 2, tension: 0
    });
  }
  const yahooOverlayPlugin = {
    id: "yahooOverlay",
    beforeDatasetsDraw(chart) {
      const {ctx, chartArea, scales: {x}} = chart;
      const divider = x.getPixelForValue(split);
      ctx.save();
      ctx.strokeStyle = chartColor("--muted");
      ctx.globalAlpha = .6;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(divider, chartArea.top);
      ctx.lineTo(divider, chartArea.bottom);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      ctx.fillStyle = chartColor("--muted");
      ctx.textBaseline = "top";
      ctx.textAlign = "right";
      ctx.fillText("HISTORY", divider - 8, chartArea.top + 6);
      ctx.textAlign = "left";
      ctx.fillText("ILLUSTRATIVE PATH", divider + 8, chartArea.top + 6);
      ctx.restore();
    },
    afterDatasetsDraw(chart) {
      const {ctx, chartArea, scales: {y}} = chart;
      const priceY = y.getPixelForValue(stock.last_close);
      if (priceY >= chartArea.top && priceY <= chartArea.bottom) {
        ctx.save();
        ctx.strokeStyle = chartColor("--muted");
        ctx.globalAlpha = .7;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left, priceY);
        ctx.lineTo(chartArea.right, priceY);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        const label = money(stock.last_close);
        ctx.font = "700 11px Inter, system-ui, sans-serif";
        const width = ctx.measureText(label).width + 12;
        ctx.fillStyle = historyColor;
        ctx.beginPath();
        ctx.roundRect(chartArea.right + 4, priceY - 10, width, 20, 4);
        ctx.fill();
        ctx.fillStyle = chartColor("--surface");
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, chartArea.right + 10, priceY + .5);
        ctx.restore();
      }
      const active = chart.tooltip?.getActiveElements?.() || [];
      if (active.length) {
        const pointX = active[0].element.x;
        ctx.save();
        ctx.strokeStyle = chartColor("--muted");
        ctx.globalAlpha = .55;
        ctx.beginPath();
        ctx.moveTo(pointX, chartArea.top);
        ctx.lineTo(pointX, chartArea.bottom);
        ctx.stroke();
        ctx.restore();
      }
    }
  };
  const projectedCloses = candles.map(candle => candle[4]);
  const minimum = Math.min(...extendedValues, ...projectedCloses) * .92;
  const maximum = Math.max(...extendedValues, ...projectedCloses) * 1.08;
  if (priceChart) priceChart.destroy();
  priceChart = new Chart(byId("stock-chart"), {
    type: "line",
    data: {datasets},
    plugins: [yahooOverlayPlugin],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      layout: {padding: {right: 8}},
      interaction: {mode: "nearest", axis: "x", intersect: false},
      plugins: {
        legend: {display: false},
        tooltip: {
          displayColors: false, backgroundColor: chartColor("--surface"), borderColor: chartColor("--border"), borderWidth: 1,
          titleColor: chartColor("--muted"), bodyColor: chartColor("--text"), padding: 10, cornerRadius: 8,
          titleFont: {weight: "500", size: 11}, bodyFont: {weight: "700", size: 13},
          callbacks: {
            title: items => new Date(dateAtX(items[0].parsed.x)).toLocaleDateString("en-US", {year: "numeric", month: "short", day: "numeric", timeZone: "UTC"}),
            label: context => `${money(context.parsed.y)}${context.datasetIndex === 1 ? " · illustrative" : ""}`
          }
        }
      },
      scales: {
        x: {type: "linear", min: 0, max: 1, ticks: {
          color: chartColor("--muted"), maxTicksLimit: 8, maxRotation: 0,
          callback: value => Number(value) <= split
            ? historyDateLabel(dateAtX(Number(value)), selectedExtendedRange)
            : new Date(dateAtX(Number(value))).toLocaleDateString("en-US", selectedForecastYears <= 2
              ? {year: "numeric", month: "short", timeZone: "UTC"}
              : {year: "numeric", timeZone: "UTC"})
        }, grid: {display: false}, border: {color: chartColor("--border")}},
        y: {type: selectedForecastScale, position: "right", min: minimum, max: maximum, beginAtZero: false,
          ticks: {color: chartColor("--muted"), maxTicksLimit: 7, padding: 8,
            callback: value => Number(value).toLocaleString("en-US", {maximumFractionDigits: Number(value) < 10 ? 2 : 0})},
          grid: {color: chartColor("--grid")}, border: {display: false, dash: [3, 3]},
          afterFit: axis => { axis.width = Math.max(axis.width, 78); }}
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
  const analogText = analog ? ` The line replays daily closes from ${analog.analog_start} to ${analog.analog_end}, rescaled to the selected endpoint.` : "";
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
