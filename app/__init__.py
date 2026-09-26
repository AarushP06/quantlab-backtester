"""Small, read-only web interface for the cached backtest universe."""

from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from flask import Flask, render_template, request

from quantlab.core import BacktestEngine, CostModel, summarise
from quantlab.strategies import BuyAndHold, MomentumRanking, MovingAverageCrossover

DATASET = Path(__file__).resolve().parents[1] / "data/processed/universe.parquet"
COST_LEVELS = {"0": CostModel(0, 0, 0), "5": CostModel()}
STRATEGIES = {
    "ma": ("Moving average 20/50", lambda: MovingAverageCrossover(20, 50)),
    "momentum": ("Momentum 6 months, top 5", lambda: MomentumRanking(6, 5)),
}


def _equity_image(result, baseline) -> str:
    fig, ax = plt.subplots(figsize=(9, 4))
    ax.plot(result.equity.index, result.equity.values, label=result.strategy_name)
    ax.plot(baseline.equity.index, baseline.equity.values, label="BuyAndHold")
    ax.set_ylabel("Portfolio equity ($)")
    ax.grid(alpha=0.25)
    ax.legend()
    fig.autofmt_xdate()
    fig.tight_layout()
    image = BytesIO()
    fig.savefig(image, format="png", dpi=110)
    plt.close(fig)
    return base64.b64encode(image.getvalue()).decode("ascii")


def _metrics(result, baseline, cost_label: str) -> list[dict]:
    table = summarise(result, baseline)
    rows = []
    for name, values in table.items():
        rows.append({
            "cost": cost_label,
            "strategy": name,
            "return": f"{values['Total return']:.1%}",
            "cagr": f"{values['CAGR']:.1%}",
            "sharpe": f"{values['Sharpe']:.2f}",
            "drawdown": f"{values['Max drawdown']:.1%}",
            "turnover": f"{values['Turnover (x/yr)']:.2f}",
            "costs": f"${values['Costs paid']:,.2f}",
            "trades": int(values["Trades"]),
        })
    return rows


def create_app(data_path: Path = DATASET) -> Flask:
    data_path = Path(data_path)
    if not data_path.is_file():
        raise FileNotFoundError(
            f"Processed dataset missing: {data_path}. "
            "Provide data/processed/universe.parquet before starting the app."
        )
    app = Flask(__name__)

    @app.get("/")
    def index():
        prices = pd.read_parquet(data_path)
        minimum = prices.index.min().date().isoformat()
        maximum = prices.index.max().date().isoformat()
        values = {
            "strategy": request.args.get("strategy", "ma"),
            "start": request.args.get("start", minimum),
            "end": request.args.get("end", maximum),
            "cost": request.args.get("cost", "5"),
        }
        context = {
            "values": values, "strategies": STRATEGIES, "min_date": minimum,
            "max_date": maximum, "metrics": None, "chart": None, "error": None,
        }
        if not request.args:
            return render_template("index.html", **context)

        try:
            if values["strategy"] not in STRATEGIES or values["cost"] not in COST_LEVELS:
                raise ValueError("Choose a listed strategy and cost level.")
            start = pd.Timestamp(values["start"])
            end = pd.Timestamp(values["end"])
            if start > end or start < prices.index.min() or end > prices.index.max():
                raise ValueError("Choose a date range within the available data.")
            selected = prices.loc[start:end]
            if len(selected) < 2:
                raise ValueError("Choose at least two trading bars.")
        except (ValueError, TypeError) as exc:
            context["error"] = str(exc)
            return render_template("index.html", **context), 400

        results = {}
        rows = []
        for cost_key, cost_model in COST_LEVELS.items():
            strategy = STRATEGIES[values["strategy"]][1]()
            result = BacktestEngine(selected, costs=cost_model).run(strategy)
            baseline = BacktestEngine(selected, costs=cost_model).run(BuyAndHold())
            results[cost_key] = result, baseline
            rows.extend(_metrics(result, baseline, f"{cost_key} bps"))
        result, baseline = results[values["cost"]]
        context["metrics"] = rows
        context["chart"] = _equity_image(result, baseline)
        context["chart_cost"] = values["cost"]
        return render_template("index.html", **context)

    return app
