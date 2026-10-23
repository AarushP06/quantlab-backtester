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
const plain = new Intl.NumberFormat("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const HORIZON_ROWS = [1, 5, 10, 15, 20];
function money(value) { return Number.isFinite(value) ? dollars.format(value) : "—"; }
function percent(value) { return Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(2)}%` : "—"; }
function capitalized(value) { return `${value[0].toUpperCase()}${value.slice(1)}`; }
function yearsLabel(years) { return `${years} ${years === 1 ? "year" : "years"}`; }
function displayDate(iso, options = {day: "numeric", month: "short", year: "numeric"}) {
  return new Date(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`).toLocaleDateString(options.day ? "en-GB" : "en-US", {...options, timeZone: "UTC"});
}
function setSigned(id, text, value) {
  const element = byId(id);
  element.textContent = text;
  element.classList.toggle("positive", value > 0);
  element.classList.toggle("negative", value < 0);
}
function setPressed(attribute, value) {
  for (const button of document.querySelectorAll(`[${attribute}]`)) {
    button.setAttribute("aria-pressed", String(button.getAttribute(attribute) === value));
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
  const historyYears = Math.max(1, Math.round((lastDate - firstDate) / (365.25 * 86400000)));
  byId("history-span-label").textContent = `${yearsLabel(historyYears)} of historical context`;
  byId("future-span-label").textContent = `${selectedForecastYears}-year illustrative scenario`;
  byId("extended-history-caption").textContent = `Historical prices and the future scenario occupy separate spans. Changing the history range changes historical context only, not the ${selectedForecastYears}-year horizon. History is saved through ${displayDate(stock.last_date)}; turns and timing of the dashed path are illustrative, not predictions.`;
  const historyColor = chartColor("--history-line");
  const pathColor = chartColor("--accent");
  const surface = chartColor("--surface");
  const muted = chartColor("--muted");
  const datasets = [{
    label: `${selectedSymbol} history`,
    data: extendedDates.map((date, index) => ({x: historyX(Date.parse(`${date}T00:00:00Z`)), y: extendedValues[index]})),
    borderColor: historyColor, fill: false,
    borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: historyColor,
    pointHoverBorderColor: surface, pointHoverBorderWidth: 2, tension: 0
  }];
  let pathPoints = [];
  if (candles.length) {
    pathPoints = dailyAnalogPoints(stock, analog, candles, futureX, lastDate) || [{x: split, y: stock.last_close}, ...candles.map(candle => ({
      x: futureX(Date.parse(`${candle[0]}T00:00:00Z`)), y: candle[4]
    }))];
    datasets.push({
      label: `${capitalized(selectedForecastView)} illustrative path`,
      data: pathPoints,
      borderColor: pathColor, backgroundColor: pathColor,
      fill: false, borderDash: [6, 4],
      borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: pathColor,
      pointHoverBorderColor: surface, pointHoverBorderWidth: 2, tension: 0
    });
  }
  const endpoint = pathPoints[pathPoints.length - 1];
  const scenarioPlugin = {
    id: "scenarioOverlay",
    afterLayout(chart) {
      // Keep the span captions under their halves of the plot as the chart resizes.
      const divider = chart.scales.x.getPixelForValue(split);
      byId("history-span-label").style.width = `${divider}px`;
      byId("future-span-label").style.width = `${chart.chartArea.right - divider}px`;
    },
    beforeDatasetsDraw(chart) {
      const {ctx, chartArea, scales: {x}} = chart;
      const divider = x.getPixelForValue(split);
      ctx.save();
      ctx.fillStyle = chartColor("--future-region");
      ctx.fillRect(divider, chartArea.top, chartArea.right - divider, chartArea.bottom - chartArea.top);
      ctx.strokeStyle = chartColor("--border-strong");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(divider + .5, chartArea.top);
      ctx.lineTo(divider + .5, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    },
    afterDatasetsDraw(chart) {
      const {ctx, chartArea, scales: {x, y}} = chart;
      const divider = x.getPixelForValue(split);
      const closeY = y.getPixelForValue(stock.last_close);
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
      const dot = (px, py, fill) => {
        ctx.fillStyle = fill;
        ctx.strokeStyle = surface;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
      dot(divider, closeY, historyColor);
      ctx.font = "400 10px Inter, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      const boundary = `Saved close · ${money(stock.last_close)}`;
      const boundaryWidth = ctx.measureText(boundary).width + 18;
      const boundaryX = Math.min(Math.max(divider - boundaryWidth / 2, chartArea.left), chartArea.right - boundaryWidth);
      ctx.fillStyle = surface;
      ctx.strokeStyle = chartColor("--border");
      ctx.beginPath();
      ctx.roundRect(boundaryX + .5, chartArea.top - 17.5, boundaryWidth, 24, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = chartColor("--text-secondary");
      ctx.fillText(boundary, boundaryX + 9, chartArea.top - 5);
      if (endpoint) {
        const endX = x.getPixelForValue(endpoint.x);
        const endY = y.getPixelForValue(endpoint.y);
        dot(endX, endY, pathColor);
        const tag = plain.format(endpoint.y);
        ctx.font = "400 10px 'IBM Plex Mono', ui-monospace, monospace";
        const width = ctx.measureText(tag).width + 14;
        ctx.fillStyle = pathColor;
        ctx.beginPath();
        ctx.roundRect(chartArea.right + 6, endY - 11.5, width, 23, 4);
        ctx.fill();
        ctx.fillStyle = chartColor("--on-accent");
        ctx.fillText(tag, chartArea.right + 13, endY + .5);
      }
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
    plugins: [scenarioPlugin],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      layout: {padding: {top: 22}},
      interaction: {mode: "nearest", axis: "x", intersect: false},
      plugins: {
        legend: {display: false},
        tooltip: {
          displayColors: false, backgroundColor: surface, borderColor: chartColor("--border"), borderWidth: 1,
          titleColor: muted, bodyColor: chartColor("--text"), padding: 10, cornerRadius: 6,
          titleFont: {family: "Inter", weight: "400", size: 11}, bodyFont: {family: "IBM Plex Mono", weight: "400", size: 12},
          callbacks: {
            title: items => new Date(dateAtX(items[0].parsed.x)).toLocaleDateString("en-GB", {year: "numeric", month: "short", day: "numeric", timeZone: "UTC"}),
            label: context => `${money(context.parsed.y)}${context.datasetIndex === 1 ? " · illustrative" : " · saved history"}`
          }
        }
      },
      scales: {
        x: {type: "linear", min: 0, max: 1, ticks: {
          color: muted, font: {family: "Inter", size: 10}, maxTicksLimit: byId("history-chart").clientWidth < 520 ? 4 : 6, autoSkipPadding: 16, maxRotation: 0, padding: 8,
          callback: value => Number(value) <= split
            ? historyDateLabel(dateAtX(Number(value)), selectedExtendedRange)
            : new Date(dateAtX(Number(value))).toLocaleDateString("en-US", selectedForecastYears <= 2
              ? {year: "numeric", month: "short", timeZone: "UTC"}
              : {year: "numeric", timeZone: "UTC"})
        }, grid: {display: false}, border: {display: false}},
        y: {type: selectedForecastScale, position: "right", min: minimum, max: maximum, beginAtZero: false,
          ticks: {color: muted, font: {family: "IBM Plex Mono", size: 10}, maxTicksLimit: 7, padding: 20,
            callback: value => plain.format(Number(value))},
          grid: {color: chartColor("--grid")}, border: {display: false},
          afterFit: axis => { axis.width = Math.max(axis.width, 96); }}
      }
    }
  });
}

function analogReturn(stock, analog) {
  if (!analog?.analog_start || !analog?.analog_end) return NaN;
  let start;
  let end;
  stock.dates.forEach((date, index) => {
    if (date.startsWith(analog.analog_start)) start = index;
    if (date.startsWith(analog.analog_end)) end = index;
  });
  return start === undefined || end === undefined ? NaN : stock.adjusted_close[end] / stock.adjusted_close[start] - 1;
}

function scenarioCell(row, outcome) {
  const cell = document.createElement("td");
  cell.textContent = `${money(outcome.adjusted_price)}  /  ${percent(outcome.total_return)}`;
  row.append(cell);
}

function renderForecast(stock) {
  const maximum = maxForecastYears(stock);
  selectedForecastYears = Math.min(selectedForecastYears, maximum);
  const yearsSelect = byId("forecast-years");
  yearsSelect.replaceChildren(...Array.from({length: maximum}, (_, index) => new Option(yearsLabel(index + 1), String(index + 1))));
  yearsSelect.value = String(selectedForecastYears);
  byId("forecast-max-years").textContent = String(maximum);
  const scenarioName = capitalized(selectedForecastView);
  byId("forecast-monogram").textContent = shortName(selectedSymbol)[0];
  byId("forecast-title").textContent = fullName(selectedSymbol);
  byId("forecast-listing").textContent = `${selectedSymbol}   /   ${listingExchange(selectedSymbol)}   /   ADJUSTED USD`;
  byId("back-to-market").href = `markets.html?symbol=${encodeURIComponent(selectedSymbol)}`;
  byId("scenario-badge").textContent = `${scenarioName} · Illustrative scenario`;
  byId("details-badge").textContent = `${scenarioName} selected`;
  byId("legend-scenario").textContent = `${scenarioName} scenario · dashed`;
  const scenario = stock.historical_scenarios[String(selectedForecastYears)];
  const outcome = scenario.outcomes[selectedForecastView];
  byId("selected-scenario-label").textContent = `${selectedForecastYears}-year scenario endpoint · ${displayDate(scenario.through_date, {month: "long", year: "numeric"})}`;
  byId("selected-scenario-price").textContent = money(outcome.adjusted_price);
  setSigned("selected-scenario-return", percent(outcome.total_return), outcome.total_return);
  byId("saved-close").textContent = money(stock.last_close);
  byId("forecast-as-of").textContent = `${displayDate(stock.last_date)} · Saved snapshot`;
  const annualized = (1 + outcome.total_return) ** (1 / selectedForecastYears) - 1;
  setSigned("scenario-annualized", `${percent(annualized)} / year`, annualized);

  const analog = forecastPaths.get(selectedSymbol)?.[String(selectedForecastYears)]?.[selectedForecastView];
  const sourceReturn = analogReturn(stock, analog);
  byId("analog-window").textContent = analog
    ? `${displayDate(analog.analog_start, {month: "short", year: "numeric"})} – ${displayDate(analog.analog_end, {month: "short", year: "numeric"})}` : "—";
  setSigned("analog-return", percent(sourceReturn), sourceReturn);
  setSigned("scenario-return", percent(outcome.total_return), outcome.total_return);
  const analogText = analog ? ` The line replays this stock’s daily closes from ${analog.analog_start} to ${analog.analog_end}, pinned to the rescaled monthly closes.` : "";
  byId("forecast-method").textContent = `Monthly rises and falls supply a historical shape. The path is anchored at the ${money(stock.last_close)} saved close and rescaled to ${money(outcome.adjusted_price)} after ${yearsLabel(selectedForecastYears)}. ${scenario.window_count} overlapping historical ${selectedForecastYears}-year windows determine the endpoint.${analogText} Dollar amounts are adjusted-price equivalents, not future quoted share prices; trading costs and taxes are not included.`;

  byId("horizons-subtitle").textContent = `Endpoint price / total return from the same ${money(stock.last_close)} saved close. All outcomes are illustrative.`;
  const horizons = [...new Set([...HORIZON_ROWS.filter(years => years <= maximum), selectedForecastYears])].sort((left, right) => left - right);
  const body = byId("forecast-body");
  body.replaceChildren();
  for (const years of horizons) {
    const row = document.createElement("tr");
    row.classList.toggle("selected", years === selectedForecastYears);
    const horizon = document.createElement("th");
    horizon.scope = "row";
    horizon.textContent = yearsLabel(years);
    row.append(horizon);
    const outcomes = stock.historical_scenarios[String(years)].outcomes;
    for (const name of ["bearish", "moderate", "bullish"]) scenarioCell(row, outcomes[name]);
    body.append(row);
  }

  const evaluation = stock.scenario_evaluation?.[String(selectedForecastYears)];
  const badge = byId("evaluation-badge");
  badge.textContent = evaluation ? "Evaluation available" : "Evaluation unavailable";
  badge.classList.toggle("neutral", !evaluation);
  byId("evaluation-title").textContent = evaluation ? `${selectedForecastYears}-year ${selectedForecastView} scenario` : "No accuracy claim";
  byId("forecast-evaluation").textContent = evaluation
    ? `${evaluation.sample_count} yearly starting points (${evaluation.first_origin} to ${evaluation.last_origin}): median return error was ${evaluation.median_error_pp[selectedForecastView].toFixed(2)} percentage points for the ${selectedForecastView} scenario versus ${evaluation.flat_baseline_error_pp.toFixed(2)} for an unchanged-price baseline. The actual return fell between bearish and bullish in ${(evaluation.range_coverage * 100).toFixed(1)}% of checks. Multi-year checks overlap; this is not trading performance.`
    : `Not enough completed historical periods to check the ${selectedForecastYears}-year scenario against later prices. A plausible-looking path is not evidence of predictive skill.`;
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
    byId("forecast-status").classList.remove("error");
  } catch (error) {
    if (selectedSymbol === symbol) {
      byId("forecast-status").textContent = `Unable to load forecast path: ${error.message}`;
      byId("forecast-status").classList.add("error");
    }
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
    byId("snapshot-date").textContent = displayDate(market.as_of);
    for (const symbol of symbols) byId("forecast-symbol").add(new Option(`${symbol} · ${fullName(symbol)}`, symbol));
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
      selectedForecastYears = Number(byId("forecast-years").value);
      renderForecast(market.symbols[selectedSymbol]);
      renderChart(market.symbols[selectedSymbol]);
    });
    for (const button of document.querySelectorAll("[data-scenario]")) button.addEventListener("click", () => {
      selectedForecastView = button.dataset.scenario;
      setPressed("data-scenario", selectedForecastView);
      renderForecast(market.symbols[selectedSymbol]);
      renderChart(market.symbols[selectedSymbol]);
    });
    for (const button of document.querySelectorAll("[data-scale]")) button.addEventListener("click", () => {
      selectedForecastScale = button.dataset.scale;
      setPressed("data-scale", selectedForecastScale);
      renderChart(market.symbols[selectedSymbol]);
    });
    for (const button of document.querySelectorAll("[data-extended-range]")) button.addEventListener("click", () => {
      selectedExtendedRange = button.dataset.extendedRange;
      setPressed("data-extended-range", selectedExtendedRange);
      renderChart(market.symbols[selectedSymbol]);
    });
    // Canvas text needs the web fonts before the first chart draw.
    await document.fonts?.ready?.catch(() => {});
    await showStock();
  } catch (error) {
    status.textContent = `Unable to display forecast data: ${error.message}`;
    status.classList.add("error");
  }
});
