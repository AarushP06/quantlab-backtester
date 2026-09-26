"""Walk-forward evaluation.

A single train/test split invites you to tweak until the test set passes, which
is overfitting with extra steps. Walk-forward retrains on a rolling window and
tests on the period immediately after, repeatedly, so every test period is
genuinely out of sample.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass
class Fold:
    train: pd.DataFrame
    test: pd.DataFrame
    label: str


def rolling_folds(
    prices: pd.DataFrame, train_years: int = 3, test_years: int = 1
) -> list[Fold]:
    """Split a price frame into consecutive train/test folds by calendar year."""
    years = sorted({ts.year for ts in prices.index})
    folds: list[Fold] = []
    for i in range(len(years) - train_years - test_years + 1):
        tr = years[i : i + train_years]
        te = years[i + train_years : i + train_years + test_years]
        folds.append(
            Fold(
                train=prices[prices.index.year.isin(tr)],
                test=prices[prices.index.year.isin(te)],
                label=f"train {tr[0]}-{tr[-1]} / test {te[0]}-{te[-1]}",
            )
        )
    return folds
