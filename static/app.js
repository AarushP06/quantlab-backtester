let manifest;
let simulatorChart;
let explorerChart;
let foldChart;
let renderToken = 0;
let selectedCost = "5";
let selectedPeriod = "full";
let selectedFold;
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

function signedMoney(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${currency.format(Math.abs(value))}` : "—";
}

function percent(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(2)}%` : "—";
}

function decimal(value) {
  return Number.isFinite(value) ? `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}` : "—";
}

function signedDecimal(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}` : "—";
}

function points(value) {
  return Number.isFinite(value) ? `${signedDecimal(value * 100)} pp` : "—";
}

function shortDate(iso, withYear = true) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", ...(withYear ? {year: "numeric"} : {}), timeZone: "UTC"
  });
}

function testPeriods() {
  return manifest.periods.filter(period => period.id !== "full");
}

// The last test fold is partial when the saved data ends before late December.
function isPartialFold(periodId) {
  return periodId === manifest.last_date.slice(0, 4) && manifest.last_date.slice(5) < "12-20";
}

function foldLabel(periodId) {
  return isPartialFold(periodId) ? `${periodId}*` : periodId;
}

function baselineHelp() {
  byId("baseline-help").textContent = byId("baseline").value === "buy_hold_on_listing"
    ? "Starts in available stocks and rebalances only when a new stock first trades."
    : "Buys on the first bar, then holds the filled shares; unfilled allocations stay in cash.";
}

function textCell(row, value, tag = "td") {
  const cell = document.createElement(tag);
  cell.textContent = value;
  if (tag === "th") cell.scope = "row";
  row.appendChild(cell);
  return cell;
}

function setSignedClass(element, value) {
  element.classList.toggle("positive", value > 0);
  element.classList.toggle("negative", value < 0);
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

function withAlpha(color, alpha) {
  const hex = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return color;
  const [r, g, b] = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function dateTick(dates, index) {
  const date = dates[index];
  if (!date) return "";
  const spanDays = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86400000;
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", spanDays > 500
    ? {month: "short", year: "numeric", timeZone: "UTC"}
    : {month: "short", timeZone: "UTC"});
}

function drawChart(canvasId, previousChart, dates, strategyValues, baselineValues, names) {
  if (!window.Chart) throw new Error("Chart.js did not load from the CDN.");
  if (previousChart) previousChart.destroy();
  const accent = chartColor("--accent");
  const muted = chartColor("--muted");
  const surface = chartColor("--surface");
  const narrow = byId(canvasId).parentElement.clientWidth < 520;
  return new Chart(byId(canvasId), {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        {
          label: names.strategy,
          data: strategyValues,
          borderColor: accent,
          backgroundColor: context => {
            const {ctx, chartArea} = context.chart;
            if (!chartArea) return "transparent";
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, withAlpha(accent, .1));
            gradient.addColorStop(1, withAlpha(accent, 0));
            return gradient;
          },
          fill: "start",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBorderColor: surface,
          tension: 0
        },
        {
          label: names.baseline,
          data: baselineValues,
          borderColor: chartColor("--baseline-line"),
          backgroundColor: chartColor("--baseline-line"),
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBorderColor: surface,
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
        legend: {display: false},
        tooltip: {
          backgroundColor: surface, borderColor: chartColor("--border"), borderWidth: 1,
          titleColor: muted, bodyColor: chartColor("--text"), padding: 10, cornerRadius: 6, boxPadding: 4,
          titleFont: {family: "Inter", size: 11}, bodyFont: {family: "IBM Plex Mono", size: 12},
          callbacks: {
            title: items => shortDate(items[0].label),
            label: context => `${context.dataset.label}: ${money(context.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          ticks: {color: muted, font: {family: "Inter", size: 10}, maxTicksLimit: narrow ? 4 : 6, autoSkipPadding: 16, maxRotation: 0, padding: 8,
            callback: (_value, index) => dateTick(dates, index)},
          grid: {display: false},
          border: {display: false}
        },
        y: {
          position: "right",
          beginAtZero: false,
          ticks: {color: muted, font: {family: "IBM Plex Mono", size: 10}, maxTicksLimit: 6, padding: 20,
            callback: value => compactCurrency.format(value)},
          grid: {color: chartColor("--grid")},
          border: {display: false}
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
  for (const label of document.querySelectorAll(".final-label")) {
    label.textContent = Number.isFinite(amount) && amount > 0 ? `Final value of ${money(amount)}` : "Final value";
  }
  for (const tag of document.querySelectorAll(".cost-tag")) tag.textContent = `${selectedCost} bps costs`;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000) {
    status.textContent = "Enter an amount between $0.01 and $1 trillion.";
    status.classList.add("error");
    byId("sim-amount").setAttribute("aria-invalid", "true");
    for (const prefix of ["sim-strategy", "sim-baseline"]) {
      for (const field of ["final", "return", "cagr", "drawdown"]) {
        byId(`${prefix}-${field}`).textContent = "—";
      }
    }
    if (simulatorChart) simulatorChart.destroy();
    simulatorChart = null;
    byId("sim-difference").textContent = "";
    for (const card of document.querySelectorAll(".outcome")) card.classList.remove("winner");
    return;
  }
  status.classList.remove("error");
  byId("sim-amount").removeAttribute("aria-invalid");
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
  byId("sim-strategy-card").classList.toggle("winner", difference > 0.005);
  byId("sim-baseline-card").classList.toggle("winner", difference < -0.005);
  const differenceLabel = Math.abs(difference) < 0.005 ? "matched" : difference > 0 ? "finished above" : "finished below";
  byId("sim-difference").textContent = differenceLabel === "matched"
    ? "Both selections finished at the same historical value."
    : `${names.strategy} ${differenceLabel} buy-and-hold by ${money(Math.abs(difference))} in this window.`;
  byId("sim-window").textContent = `${shortDate(window.first_date)} → ${shortDate(window.last_date)}`;
  byId("sim-chart-subtitle").textContent = `${window.start_year}–${window.end_year} · Both start at ${money(amount)} · Same dates and ${selectedCost} bps trading costs`;
  byId("sim-legend-strategy").textContent = `Strategy · ${money(amount * strategy.final_per_dollar)}`;
  byId("sim-legend-baseline").textContent = `Buy-and-hold · ${money(amount * baseline.final_per_dollar)}`;
  simulatorChart = drawChart(
    "sim-chart", simulatorChart, dates,
    strategy.equity_per_dollar.map(value => value * amount),
    baseline.equity_per_dollar.map(value => value * amount), names
  );
  status.textContent = `One continuous investment · ${window.bars.toLocaleString()} trading bars. The final year may be partial.`;
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
  const cagrGap = average("cagr");
  const drawdownGap = average("drawdown");
  byId("verdict-gap").textContent = points(cagrGap);
  byId("verdict-drawdown").textContent = points(drawdownGap);
  setSignedClass(byId("verdict-gap"), cagrGap);
  setSignedClass(byId("verdict-drawdown"), drawdownGap);
  byId("verdict-range").textContent = `Test folds · ${folds[0].id}–${folds[folds.length - 1].id} · ${cost} bps`;
  byId("verdict-line").textContent = names.strategy === names.baseline
    ? "The same portfolio is selected on both sides of the comparison."
    : `${names.strategy} beat ${names.baseline} in ${wins} of ${folds.length} test years at ${cost} bps.`;
  const last = folds[folds.length - 1].id;
  byId("verdict-note").textContent = `Each test year restarts the portfolio.${isPartialFold(last) ? ` ${last} is partial through ${shortDate(manifest.last_date)}.` : ""} Gaps are strategy minus baseline in percentage points; fold averages are simple averages, not compounded returns.`;
}

function renderPeriodMetrics(strategy, baseline, names) {
  byId("period-strategy-heading").textContent = names.strategy;
  byId("period-baseline-heading").textContent = names.baseline;
  const finalValue = result => result.equity[result.equity.length - 1];
  const count = value => Number.isFinite(value) ? value.toLocaleString() : "—";
  const rows = [
    ["Final value", null, money, signedMoney],
    ["Total return", "total_return", percent, points],
    ["CAGR", "cagr", percent, points],
    ["Sharpe ratio", "sharpe", decimal, signedDecimal],
    ["Max drawdown", "max_drawdown", percent, points],
    ["Turnover / year", "turnover", decimal, signedDecimal],
    ["Costs paid", "costs_paid", money, signedMoney],
    ["Trades", "trades", count, value => Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${Math.abs(value).toLocaleString()}` : "—"]
  ];
  const body = byId("period-metrics-body");
  body.replaceChildren();
  for (const [label, key, formatter, differenceFormatter] of rows) {
    const strategyValue = key ? strategy.metrics[key] : finalValue(strategy);
    const baselineValue = key ? baseline.metrics[key] : finalValue(baseline);
    const row = document.createElement("tr");
    textCell(row, label, "th");
    textCell(row, formatter(strategyValue));
    textCell(row, formatter(baselineValue));
    textCell(row, differenceFormatter(strategyValue - baselineValue));
    body.appendChild(row);
  }
  const drawdownGap = strategy.metrics.max_drawdown - baseline.metrics.max_drawdown;
  byId("drawdown-note").textContent = Number.isFinite(drawdownGap)
    ? `A ${points(drawdownGap)} max drawdown gap means the strategy’s drawdown was ${Math.abs(drawdownGap * 100).toFixed(2)} percentage points ${drawdownGap >= 0 ? "shallower" : "deeper"}.`
    : "";
}

function syncPeriodControls() {
  for (const button of document.querySelectorAll("[data-period-mode]")) {
    button.setAttribute("aria-pressed", String((button.dataset.periodMode === "full") === (selectedPeriod === "full")));
  }
  byId("period").value = selectedFold;
  byId("period").disabled = selectedPeriod === "full";
}

function selectPeriod(periodId, strategyResults, baselineResults, names) {
  selectedPeriod = periodId;
  if (periodId !== "full") selectedFold = periodId;
  syncPeriodControls();
  renderExplorer(strategyResults, baselineResults, names);
  renderFolds(strategyResults, baselineResults, names);
  renderFoldChart(strategyResults, baselineResults, names);
}

function renderTimeline() {
  const period = manifest.periods.find(item => item.id === selectedFold);
  const match = period?.label.match(/train (\d{4})-(\d{4})/);
  const timeline = byId("fold-timeline");
  timeline.replaceChildren();
  const block = (year, label, className) => {
    const item = document.createElement("div");
    if (className) item.className = className;
    const strong = document.createElement("strong");
    strong.textContent = year;
    const span = document.createElement("span");
    span.textContent = label;
    item.append(strong, span);
    timeline.append(item);
  };
  if (match) {
    for (let year = Number(match[1]); year <= Number(match[2]); year += 1) block(String(year), "Training");
  }
  const arrow = document.createElement("span");
  arrow.className = "arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "→";
  timeline.append(arrow);
  block(foldLabel(selectedFold), selectedPeriod === "full" ? "Test" : "Test · selected", "test");
}

function renderFolds(strategyResults, baselineResults, names) {
  const body = byId("folds-body");
  body.replaceChildren();
  for (const period of testPeriods()) {
    const strategy = strategyResults.periods[period.id].metrics;
    const baseline = baselineResults.periods[period.id].metrics;
    const row = document.createElement("tr");
    row.className = "fold-row";
    row.classList.toggle("selected", period.id === selectedPeriod);
    const yearCell = document.createElement("th");
    yearCell.scope = "row";
    const yearButton = document.createElement("button");
    yearButton.type = "button";
    yearButton.className = "fold-link";
    yearButton.textContent = foldLabel(period.id);
    yearButton.setAttribute("aria-label", `Inspect ${period.id} test year`);
    yearButton.setAttribute("aria-pressed", String(period.id === selectedPeriod));
    yearButton.addEventListener("click", event => {
      event.stopPropagation();
      selectPeriod(period.id, strategyResults, baselineResults, names);
    });
    yearCell.appendChild(yearButton);
    row.appendChild(yearCell);
    textCell(row, percent(strategy.cagr));
    textCell(row, percent(baseline.cagr));
    const gap = strategy.cagr - baseline.cagr;
    setSignedClass(textCell(row, signedDecimal(gap * 100)), gap);
    textCell(row, decimal(strategy.sharpe));
    textCell(row, decimal(baseline.sharpe));
    textCell(row, percent(strategy.max_drawdown));
    textCell(row, percent(baseline.max_drawdown));
    row.addEventListener("click", () => selectPeriod(period.id, strategyResults, baselineResults, names));
    body.appendChild(row);
  }
  const folds = testPeriods();
  byId("folds-badge").textContent = `${folds.length} test folds · Saved results`;
  const last = folds[folds.length - 1].id;
  const partial = isPartialFold(last)
    ? `*${last} is partial through ${shortDate(manifest.last_date)}; CAGR is annualized. `
    : "";
  byId("folds-note").textContent = `${partial}Difference is strategy CAGR minus baseline CAGR in percentage points. Each row is a restarted test fold, not a year of a continuous equity curve.`;
  byId("partial-note").textContent = `${partial}Each bar is one restarted test fold, not a year of a continuous equity curve.`;
}

function renderFoldChart(strategyResults, baselineResults, names) {
  if (foldChart) foldChart.destroy();
  const folds = testPeriods();
  const gaps = folds.map(period =>
    (strategyResults.periods[period.id].metrics.cagr -
      baselineResults.periods[period.id].metrics.cagr) * 100
  );
  const selectedIndex = folds.findIndex(period => period.id === selectedPeriod);
  const muted = chartColor("--muted");
  const accent = chartColor("--accent");
  const loss = chartColor("--loss");
  byId("fold-badge").textContent = selectedIndex >= 0
    ? `${selectedPeriod} selected · ${signedDecimal(gaps[selectedIndex])} pp`
    : "Full period selected";
  byId("fold-badge").classList.toggle("neutral", selectedIndex < 0);
  const highlightPlugin = {
    id: "selectedFold",
    beforeDatasetsDraw(chart) {
      if (selectedIndex < 0) return;
      const {ctx, chartArea, scales: {x}} = chart;
      const width = x.width / folds.length;
      const center = x.getPixelForValue(selectedIndex);
      ctx.save();
      ctx.fillStyle = chartColor("--accent-soft");
      ctx.beginPath();
      ctx.roundRect(center - width / 2 + 2, chartArea.top, width - 4, chart.height - chartArea.top, 6);
      ctx.fill();
      ctx.restore();
    },
    afterDatasetsDraw(chart) {
      if (selectedIndex < 0) return;
      const bar = chart.getDatasetMeta(0).data[selectedIndex];
      const {ctx} = chart;
      const value = gaps[selectedIndex];
      ctx.save();
      ctx.font = "400 10px 'IBM Plex Mono', ui-monospace, monospace";
      ctx.fillStyle = value >= 0 ? accent : loss;
      ctx.textAlign = "center";
      ctx.textBaseline = value >= 0 ? "bottom" : "top";
      ctx.fillText(signedDecimal(value), bar.x, value >= 0 ? bar.y - 5 : bar.y + 5);
      ctx.restore();
    }
  };
  foldChart = new Chart(byId("fold-chart"), {
    type: "bar",
    data: {labels: folds.map(period => foldLabel(period.id)), datasets: [{
      label: "CAGR gap (percentage points)", data: gaps,
      backgroundColor: gaps.map((value, index) => index === selectedIndex
        ? (value >= 0 ? accent : loss)
        : chartColor(value >= 0 ? "--bar-positive" : "--bar-negative")),
      borderRadius: 3, borderSkipped: "start",
      categoryPercentage: .7, barPercentage: .78
    }]},
    plugins: [highlightPlugin],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: {padding: {top: 18}},
      onClick: (_event, elements) => {
        if (elements.length) {
          selectPeriod(folds[elements[0].index].id, strategyResults, baselineResults, names);
        }
      },
      onHover: (event, elements) => {
        event.native.target.style.cursor = elements.length ? "pointer" : "default";
      },
      plugins: {
        legend: {display: false},
        tooltip: {
          displayColors: false, backgroundColor: chartColor("--surface"), borderColor: chartColor("--border"), borderWidth: 1,
          titleColor: muted, bodyColor: chartColor("--text"), padding: 10, cornerRadius: 6,
          titleFont: {family: "Inter", size: 11}, bodyFont: {family: "IBM Plex Mono", size: 12},
          callbacks: {label: context => `${points(context.parsed.y / 100)} versus ${names.baseline}`}
        }
      },
      scales: {
        x: {ticks: {color: muted, font: context => ({family: "Inter", size: 10, weight: context.index === selectedIndex ? "600" : "400"}),
          maxRotation: 0, autoSkip: true, maxTicksLimit: 20}, grid: {display: false}, border: {display: false}},
        y: {position: "right", ticks: {color: muted, font: {family: "IBM Plex Mono", size: 10}, padding: 20, maxTicksLimit: 6,
          callback: value => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)} pp`},
          grid: {color: context => context.tick.value === 0 ? chartColor("--border-strong") : chartColor("--grid")},
          border: {display: false}}
      }
    }
  });
}

function renderExplorer(strategyResults, baselineResults, names) {
  const periodId = selectedPeriod;
  const strategy = strategyResults.periods[periodId];
  const baseline = baselineResults.periods[periodId];
  if (!strategy || !baseline) throw new Error(`Period ${periodId} is unavailable.`);
  explorerChart = drawChart(
    "period-chart", explorerChart, strategy.dates,
    strategy.equity, baseline.equity, names
  );
  renderPeriodMetrics(strategy, baseline, names);
  renderTimeline();
  const first = strategy.dates[0];
  const last = strategy.dates[strategy.dates.length - 1];
  const start = money(strategy.equity[0]);
  const isFull = periodId === "full";
  byId("period-mode-full").textContent = `Full period · ${first.slice(0, 4)}–${last.slice(0, 4)}`;
  byId("period-subtitle").textContent = isFull
    ? `Chart period · Full period · ${shortDate(first)} – ${shortDate(last)}`
    : `Chart period · Test fold ${periodId} · ${shortDate(first, false)} – ${shortDate(last)}${isPartialFold(periodId) ? " · partial year" : ""}`;
  byId("period-normalization").textContent = isFull
    ? `Full period · One continuous portfolio from ${start}`
    : `Test fold · Each series restarts at ${start}`;
  byId("period-legend-strategy").textContent = `Strategy · ${money(strategy.equity[strategy.equity.length - 1])}`;
  byId("period-legend-baseline").textContent = `Buy-and-hold · ${money(baseline.equity[baseline.equity.length - 1])}`;
  byId("metrics-context").textContent = `${isFull ? "Full period" : `Test fold ${periodId}`} · ${start} start · ${selectedCost} bps costs`;
}

async function render() {
  const token = ++renderToken;
  const status = byId("data-status");
  const strategyId = byId("strategy").value;
  const baselineId = byId("baseline").value;
  const cost = selectedCost;
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

function renderStudyFacts() {
  const firstYear = manifest.first_date.slice(0, 4);
  const lastYear = manifest.last_date.slice(0, 4);
  byId("notice-range").textContent = ` from ${shortDate(manifest.first_date)} to ${shortDate(manifest.last_date)}`;
  byId("fact-years").textContent = `${firstYear}–${lastYear}`;
  byId("fact-universe").textContent = `${manifest.symbols} large caps`;
  byId("study-limits-text").textContent = `The universe contains ${manifest.symbols} large caps selected today, creating upward selection bias in historical comparisons. Adjusted US equity data covers ${shortDate(manifest.first_date)} to ${shortDate(manifest.last_date)}. Signals use information from the current bar and execute at the next bar’s open; adjusted historical prices are not executable quotes.`;
}

function renderCostOptions() {
  const group = byId("cost");
  group.replaceChildren();
  for (const choice of manifest.costs) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.cost = choice.id;
    button.textContent = choice.label;
    button.setAttribute("aria-pressed", String(choice.id === selectedCost));
    button.addEventListener("click", () => {
      selectedCost = choice.id;
      for (const item of group.querySelectorAll("button")) {
        item.setAttribute("aria-pressed", String(item.dataset.cost === selectedCost));
      }
      render();
    });
    group.append(button);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    manifest = await loadJson("data/manifest.json");
    optionsFor(byId("strategy"), manifest.strategies);
    optionsFor(byId("baseline"), manifest.strategies.filter(
      item => manifest.baseline_options.includes(item.id)
    ));
    optionsFor(byId("period"), testPeriods().map(period => ({id: period.id, label: foldLabel(period.id)})));
    optionsFor(byId("sim-horizon"), manifest.horizons.map(horizon => ({
      id: String(horizon), label: `${horizon} calendar ${horizon === 1 ? "year" : "years"}`
    })));
    byId("strategy").value = "ma_20_50";
    byId("baseline").value = manifest.default_baseline;
    selectedCost = manifest.costs.some(item => item.id === "5") ? "5" : manifest.costs[0].id;
    const folds = testPeriods();
    selectedFold = (folds.find(period => !isPartialFold(period.id) && period.id === String(Number(manifest.last_date.slice(0, 4)) - 1)) || folds[folds.length - 1]).id;
    selectedPeriod = "full";
    syncPeriodControls();
    renderCostOptions();
    renderStudyFacts();
    byId("sim-horizon").value = "10";
    updateStartYears("2015");
    for (const id of ["strategy", "baseline", "sim-start", "sim-amount"]) {
      byId(id).addEventListener("change", render);
    }
    byId("period").addEventListener("change", () => {
      selectedFold = byId("period").value;
      selectedPeriod = selectedFold;
      syncPeriodControls();
      render();
    });
    for (const button of document.querySelectorAll("[data-period-mode]")) {
      button.addEventListener("click", () => {
        selectedPeriod = button.dataset.periodMode === "full" ? "full" : selectedFold;
        syncPeriodControls();
        render();
      });
    }
    byId("sim-horizon").addEventListener("change", () => {
      updateStartYears(byId("sim-start").value);
      render();
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", render);
    // Canvas text needs the web fonts before the first chart draw.
    await document.fonts?.ready?.catch(() => {});
    await render();
  } catch (error) {
    byId("data-status").textContent = `Unable to load precomputed data: ${error.message}`;
    byId("data-status").classList.add("error");
  }
});
