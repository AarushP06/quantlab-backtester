let manifest;
let simulatorChart;
let explorerChart;
let renderToken = 0;
const responseCache = new Map();

const byId = id => document.getElementById(id);
const currency = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2
});
const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1
});

function money(value) {
  return Number.isFinite(value) ? currency.format(value) : "—";
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

function decimal(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

function textCell(row, value, tag = "td") {
  const cell = document.createElement(tag);
  cell.textContent = value;
  row.appendChild(cell);
}

function optionsFor(select, choices) {
  select.replaceChildren();
  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.id;
    option.textContent = choice.label;
    select.appendChild(option);
  }
}

async function loadJson(path) {
  if (!responseCache.has(path)) {
    const pending = fetch(path).then(response => {
      if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
      return response.json();
    }).catch(error => {
      responseCache.delete(path);
      throw error;
    });
    responseCache.set(path, pending);
  }
  return responseCache.get(path);
}

function chartColor(variable) {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

function drawChart(canvasId, previousChart, dates, strategyValues, baselineValues, names) {
  if (!window.Chart) throw new Error("Chart.js did not load from the CDN.");
  if (previousChart) previousChart.destroy();
  return new Chart(byId(canvasId), {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        {
          label: names.strategy,
          data: strategyValues,
          borderColor: chartColor("--accent"),
          backgroundColor: chartColor("--accent"),
          borderWidth: 2,
          pointRadius: 0,
          tension: 0
        },
        {
          label: names.baseline,
          data: baselineValues,
          borderColor: chartColor("--baseline"),
          backgroundColor: chartColor("--baseline"),
          borderWidth: 2,
          pointRadius: 0,
          tension: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {mode: "index", intersect: false},
      plugins: {
        legend: {position: "bottom", labels: {color: chartColor("--text")}},
        tooltip: {callbacks: {label: context => `${context.dataset.label}: ${money(context.parsed.y)}`}}
      },
      scales: {
        x: {
          ticks: {color: chartColor("--muted"), maxTicksLimit: 8, maxRotation: 0},
          grid: {color: chartColor("--grid")}
        },
        y: {
          ticks: {color: chartColor("--muted"), callback: value => compactCurrency.format(value)},
          grid: {color: chartColor("--grid")}
        }
      }
    }
  });
}

function eligibleWindows() {
  const horizon = Number(byId("sim-horizon").value);
  return manifest.windows.filter(window => window.horizon === horizon);
}

function updateStartYears(preferred) {
  const windows = eligibleWindows();
  optionsFor(byId("sim-start"), windows.map(window => ({
    id: String(window.start_year), label: String(window.start_year)
  })));
  const selected = windows.find(window => String(window.start_year) === String(preferred));
  byId("sim-start").value = selected ? String(selected.start_year) : String(windows[0].start_year);
}

function renderOutcome(prefix, label, window, amount) {
  byId(`${prefix}-name`).textContent = label;
  byId(`${prefix}-final`).textContent = money(amount * window.final_per_dollar);
  byId(`${prefix}-return`).textContent = percent(window.metrics.total_return);
  byId(`${prefix}-cagr`).textContent = percent(window.metrics.cagr);
  byId(`${prefix}-drawdown`).textContent = percent(window.metrics.max_drawdown);
}

function renderSimulator(strategyResults, baselineResults, sharedDates, names) {
  const amount = Number(byId("sim-amount").value);
  const status = byId("sim-status");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000) {
    status.textContent = "Enter an amount between $0.01 and $1 trillion.";
    status.classList.add("error");
    for (const prefix of ["sim-strategy", "sim-baseline"]) {
      for (const field of ["final", "return", "cagr", "drawdown"]) {
        byId(`${prefix}-${field}`).textContent = "—";
      }
    }
    if (simulatorChart) simulatorChart.destroy();
    simulatorChart = null;
    return;
  }
  status.classList.remove("error");
  const windowId = `${byId("sim-start").value}_${byId("sim-horizon").value}`;
  const window = manifest.windows.find(item => item.id === windowId);
  const strategy = strategyResults.windows[windowId];
  const baseline = baselineResults.windows[windowId];
  const dates = sharedDates.dates[windowId];
  if (!window || !strategy || !baseline || !dates) {
    throw new Error(`Historical window ${windowId} is unavailable.`);
  }
  renderOutcome("sim-strategy", names.strategy, strategy, amount);
  renderOutcome("sim-baseline", names.baseline, baseline, amount);
  simulatorChart = drawChart(
    "sim-chart", simulatorChart, dates,
    strategy.equity_per_dollar.map(value => value * amount),
    baseline.equity_per_dollar.map(value => value * amount), names
  );
  status.textContent = `${window.first_date} to ${window.last_date} · ${window.bars.toLocaleString()} trading bars. The final year may be partial.`;
}

function renderPeriodMetrics(strategy, baseline, names) {
  byId("period-strategy-heading").textContent = names.strategy;
  byId("period-baseline-heading").textContent = names.baseline;
  const rows = [
    ["Total return", "total_return", percent],
    ["CAGR", "cagr", percent],
    ["Sharpe", "sharpe", decimal],
    ["Max drawdown", "max_drawdown", percent],
    ["Turnover / year", "turnover", decimal],
    ["Costs paid", "costs_paid", money],
    ["Trades", "trades", value => Number.isFinite(value) ? value.toLocaleString() : "—"]
  ];
  const body = byId("period-metrics-body");
  body.replaceChildren();
  for (const [label, key, formatter] of rows) {
    const row = document.createElement("tr");
    textCell(row, label, "th");
    textCell(row, formatter(strategy.metrics[key]));
    textCell(row, formatter(baseline.metrics[key]));
    body.appendChild(row);
  }
}

function renderFolds(strategyResults, baselineResults) {
  const body = byId("folds-body");
  body.replaceChildren();
  for (const period of manifest.periods.filter(item => item.id !== "full")) {
    const strategy = strategyResults.periods[period.id].metrics;
    const baseline = baselineResults.periods[period.id].metrics;
    const row = document.createElement("tr");
    textCell(row, period.id);
    textCell(row, percent(strategy.cagr));
    textCell(row, percent(baseline.cagr));
    textCell(row, `${decimal((strategy.cagr - baseline.cagr) * 100)} pp`);
    textCell(row, decimal(strategy.sharpe));
    textCell(row, decimal(baseline.sharpe));
    textCell(row, percent(strategy.max_drawdown));
    textCell(row, percent(baseline.max_drawdown));
    body.appendChild(row);
  }
}

function renderExplorer(strategyResults, baselineResults, names) {
  const periodId = byId("period").value;
  const strategy = strategyResults.periods[periodId];
  const baseline = baselineResults.periods[periodId];
  if (!strategy || !baseline) throw new Error(`Period ${periodId} is unavailable.`);
  explorerChart = drawChart(
    "period-chart", explorerChart, strategy.dates,
    strategy.equity, baseline.equity, names
  );
  renderPeriodMetrics(strategy, baseline, names);
  renderFolds(strategyResults, baselineResults);
}

async function render() {
  const token = ++renderToken;
  const status = byId("data-status");
  const strategyId = byId("strategy").value;
  const baselineId = byId("baseline").value;
  const cost = byId("cost").value;
  const strategySpec = manifest.strategies.find(item => item.id === strategyId);
  const baselineSpec = manifest.strategies.find(item => item.id === baselineId);
  const names = {strategy: strategySpec.label, baseline: baselineSpec.label};
  status.textContent = "Loading historical results…";
  status.classList.remove("error");
  try {
    const [strategyPeriods, baselinePeriods, strategyWindows, baselineWindows, dates] = await Promise.all([
      loadJson(strategySpec.files[cost]),
      loadJson(baselineSpec.files[cost]),
      loadJson(strategySpec.simulator_files[cost]),
      loadJson(baselineSpec.simulator_files[cost]),
      loadJson(manifest.windows_file)
    ]);
    if (token !== renderToken) return;
    renderSimulator(strategyWindows, baselineWindows, dates, names);
    renderExplorer(strategyPeriods, baselinePeriods, names);
    status.textContent = `${manifest.bars.toLocaleString()} adjusted daily bars · ${manifest.symbols} symbols · ${manifest.first_date} to ${manifest.last_date}. All results were precomputed.`;
  } catch (error) {
    if (token === renderToken) {
      status.textContent = `Unable to display results: ${error.message}`;
      status.classList.add("error");
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    manifest = await loadJson("data/manifest.json");
    optionsFor(byId("strategy"), manifest.strategies);
    optionsFor(byId("baseline"), manifest.strategies.filter(
      item => manifest.baseline_options.includes(item.id)
    ));
    optionsFor(byId("cost"), manifest.costs);
    optionsFor(byId("period"), manifest.periods);
    optionsFor(byId("sim-horizon"), manifest.horizons.map(horizon => ({
      id: String(horizon), label: `${horizon} ${horizon === 1 ? "year" : "years"}`
    })));
    byId("strategy").value = "ma_20_50";
    byId("baseline").value = manifest.default_baseline;
    byId("cost").value = "5";
    byId("sim-horizon").value = "10";
    updateStartYears("2015");
    for (const id of ["strategy", "baseline", "cost", "period", "sim-start", "sim-amount"]) {
      byId(id).addEventListener("change", render);
    }
    byId("sim-horizon").addEventListener("change", () => {
      updateStartYears(byId("sim-start").value);
      render();
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", render);
    await render();
  } catch (error) {
    byId("data-status").textContent = `Unable to load precomputed data: ${error.message}`;
    byId("data-status").classList.add("error");
  }
});
