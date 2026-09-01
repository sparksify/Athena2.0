"""Splink model for candidate deduplication.

Deterministic exact email/phone matching already happened at import (Phase 1);
this model finds the non-exact duplicates between candidates: same human,
different email, matched on name/geography/phone similarity with a
probabilistic score. Trained unsupervised (u from random sampling, m via EM);
a labeled sample only evaluates it (evaluate.py), it is not required to run.
"""

from __future__ import annotations

import pandas as pd
import splink.comparison_library as cl
from splink import DuckDBAPI, Linker, SettingsCreator, block_on

REQUIRED_COLUMNS = ["id", "full_name", "email", "phone", "city", "state"]


def make_settings() -> SettingsCreator:
    return SettingsCreator(
        link_type="dedupe_only",
        unique_id_column_name="id",
        comparisons=[
            cl.ForenameSurnameComparison("first_name", "last_name"),
            cl.EmailComparison("email"),
            cl.ExactMatch("phone"),
            cl.ExactMatch("city"),
            cl.ExactMatch("state"),
        ],
        blocking_rules_to_generate_predictions=[
            block_on("phone"),
            block_on("last_name", "state"),
            block_on("city"),
            block_on("split_part(email, '@', 1)"),
        ],
        retain_intermediate_calculation_columns=False,
    )


def resolve(records: list[dict]) -> list[dict]:
    """records: [{id, full_name, email, phone, city, state}] →
    [{left_id, right_id, confidence}] for pairs above 0.5."""
    df = pd.DataFrame.from_records(records)
    for col in REQUIRED_COLUMNS:
        if col not in df.columns:
            df[col] = None
    df = df[REQUIRED_COLUMNS]
    names = df["full_name"].fillna("").astype(str).str.strip()
    df["first_name"] = names.str.split().str[0].replace("", None)
    df["last_name"] = names.str.split(n=1).str[-1].where(names.str.contains(" "), None)

    linker = Linker(df, make_settings(), db_api=DuckDBAPI())
    linker.training.estimate_probability_two_random_records_match(
        [block_on("phone"), block_on("last_name", "state")], recall=0.7
    )
    linker.training.estimate_u_using_random_sampling(max_pairs=1e6)
    # two EM passes so every comparison's m values train: the first can't
    # train the columns it blocks on, the second covers them
    linker.training.estimate_parameters_using_expectation_maximisation(
        block_on("last_name", "state")
    )
    linker.training.estimate_parameters_using_expectation_maximisation(block_on("phone"))

    predictions = linker.inference.predict(threshold_match_probability=0.5)
    rows = predictions.as_pandas_dataframe()
    return [
        {
            "left_id": r["id_l"],
            "right_id": r["id_r"],
            "confidence": round(float(r["match_probability"]), 4),
        }
        for _, r in rows.iterrows()
    ]
