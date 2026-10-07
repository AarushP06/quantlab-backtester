let manifest;
let simulatorChart;
let explorerChart;
let foldChart;
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

function points(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)} pp` : "—";
}

function testPeriods() {
  return manifest.periods.filter(period => period.id !== "full");
}

function baselineHelp() {
  byId("baseline-help").textContent = byId("baseline").value === "buy_hold_on_listing"
    ? "Starts in available stocks and rebalances only when a new stock first trades."
    : "Buys on the first bar, then holds the filled shares; unfilled allocations stay in cash.";
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
    byId("sim-difference").hidden = true;
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
  const difference = amount * (strategy.final_per_dollar - baseline.final_per_dollar);
  const differenceLabel = Math.abs(difference) < 0.005 ? "matched" : difference > 0 ? "finished above" : "finished below";
  byId("sim-difference").textContent = differenceLabel === "matched"
    ? "Both selections finished at the same historical value."
    : `${names.strategy} ${differenceLabel} buy-and-hold by ${money(Math.abs(difference))} in this window.`;
  byId("sim-difference").hidden = false;
  simulatorChart = drawChart(
    "sim-chart", simulatorChart, dates,
    strategy.equity_per_dollar.map(value => value * amount),
    baseline.equity_per_dollar.map(value => value * amount), names
  );
  status.textContent = `${window.first_date} to ${window.last_date} · ${window.bars.toLocaleString()} trading bars. The final year may be partial.`;
}

function renderVerdict(strategyResults, baselineResults, names, cost) {
  const folds = testPeriods();
  const differences = folds.map(period => {
    const strategy = strategyResults.periods[period.id].metrics;
    const baseline = baselineResults.periods[period.id].metrics;
    return {cagr: strategy.cagr - baseline.cagr,
      drawdown: strategy.max_drawdown - baseline.max_drawdown};
  });
  const wins = differences.filter(item => item.cagr > 0).length;
  const average = key => differences.reduce((sum, item) => sum + item[key], 0) / differences.length;
  byId("verdict-wins").textContent = `${wins} / ${folds.length}`;
  byId("verdict-gap").textContent = points(average("cagr"));
  byId("verdict-drawdown").textContent = points(average("drawdown"));
  byId("verdict-line").textContent = names.strategy === names.baseline
    ? "The same portfolio is selected on both sides of the comparison."
    : `${names.strategy} beat ${names.baseline} in ${wins} of ${folds.length} test years at ${cost} bps.`;
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

function selectPeriod(periodId, strategyResults, baselineResults, names) {
  byId("period").value = periodId;
  renderExplorer(strategyResults, baselineResults, names);
  renderFolds(strategyResults, baselineResults, names);
  renderFoldChart(strategyResults, baselineResults, names);
}

function renderFolds(strategyResults, baselineResults, names) {
  const body = byId("folds-body");
  body.replaceChildren();
  for (const period of testPeriods()) {
    const strategy = strategyResults.periods[period.id].metrics;
    const baseline = baselineResults.periods[period.id].metrics;
    const row = document.createElement("tr");
    row.className = "fold-row";
    row.classList.toggle("selected", period.id === byId("period").value);
    const yearCell = document.createElement("td");
    const yearButton = document.createElement("button");
    yearButton.type = "button";
    yearButton.className = "fold-link";
    yearButton.textContent = period.id;
    yearButton.setAttribute("aria-label", `Inspect ${period.id} test year`);
    yearButton.addEventListener("click", event => {
      event.stopPropagation();
      selectPeriod(period.id, strategyResults, baselineResults, names);
    });
    yearCell.appendChild(yearButton);
    row.appendChild(yearCell);
    textCell(row, percent(strategy.cagr));
    textCell(row, percent(baseline.cagr));
    textCell(row, `${decimal((strategy.cagr - baseline.cagr) * 100)} pp`);
    textCell(row, decimal(strategy.sharpe));
    textCell(row, decimal(baseline.sharpe));
    textCell(row, percent(strategy.max_drawdown));
    textCell(row, percent(baseline.max_drawdown));
    row.addEventListener("click", () => selectPeriod(period.id, strategyResults, baselineResults, names));
    body.appendChild(row);
  }
}

function renderFoldChart(strategyResults, baselineResults, names) {
  if (foldChart) foldChart.destroy();
  const folds = testPeriods();
  const gaps = folds.map(period =>
    (strategyResults.periods[period.id].metrics.cagr -
      baselineResults.periods[period.id].metrics.cagr) * 100
  );
  const selected = byId("period").value;
  foldChart = new Chart(byId("fold-chart"), {
    type: "bar",
    data: {labels: folds.map(period => period.id), datasets: [{
      label: "CAGR gap (percentage points)", data: gaps,
      backgroundColor: gaps.map(value => value >= 0 ? chartColor("--accent") : "#b85a52"),
      borderColor: chartColor("--text"),
      borderWidth: folds.map(period => period.id === selected ? 2 : 0)
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      onClick: (_event, elements) => {
        if (elements.length) {
          selectPeriod(folds[elements[0].index].id, strategyResults, baselineResults, names);
        }
      },
      plugins: {
        legend: {display: false},
        tooltip: {callbacks: {label: context => `${points(context.parsed.y / 100)} versus ${names.baseline}`}}
      },
      scales: {
        x: {ticks: {color: chartColor("--muted"), maxRotation: 0, autoSkip: true,
          maxTicksLimit: 10}, grid: {display: false}},
        y: {ticks: {color: chartColor("--muted"), callback: value => `${value} pp`},
          grid: {color: chartColor("--grid")}}
      }
    }
  });
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
    baselineHelp();
    renderVerdict(strategyPeriods, baselinePeriods, names, cost);
    renderSimulator(strategyWindows, baselineWindows, dates, names);
    renderExplorer(strategyPeriods, baselinePeriods, names);
    renderFolds(strategyPeriods, baselinePeriods, names);
    renderFoldChart(strategyPeriods, baselinePeriods, names);
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
