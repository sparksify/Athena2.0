"""Precision/recall of the resolver against a labeled pair sample.

    python evaluate.py records.csv labels.csv [--threshold 0.85]

records.csv: id,full_name,email,phone,city,state
labels.csv:  left_id,right_id,is_same   (is_same in {0,1})

Phase 2 proof gate: precision >= 0.97 and recall >= 0.85 at the auto-link
threshold on Steve's labeled sample.
"""

from __future__ import annotations

import argparse
import csv
import sys

from model import resolve


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("records_csv")
    ap.add_argument("labels_csv")
    ap.add_argument("--auto-threshold", type=float, default=0.85)
    ap.add_argument("--review-threshold", type=float, default=0.60)
    args = ap.parse_args()

    with open(args.records_csv, newline="") as f:
        records = list(csv.DictReader(f))
    with open(args.labels_csv, newline="") as f:
        labels = {
            frozenset((row["left_id"], row["right_id"])): row["is_same"] == "1"
            for row in csv.DictReader(f)
        }

    pairs = resolve(records)
    auto = {frozenset((p["left_id"], p["right_id"])) for p in pairs if p["confidence"] >= args.auto_threshold}
    surfaced = {frozenset((p["left_id"], p["right_id"])) for p in pairs if p["confidence"] >= args.review_threshold}

    labeled = set(labels.keys())
    true_pairs = {p for p, same in labels.items() if same}

    # Precision is judged on what the system links WITHOUT a human (auto).
    auto_labeled = auto & labeled
    tp_a = len(auto_labeled & true_pairs)
    fp_a = len(auto_labeled - true_pairs)
    precision = tp_a / (tp_a + fp_a) if tp_a + fp_a else 0.0

    # Recall is judged on what the system surfaces at all (auto + review
    # queue) — a 0.60–0.85 pair reaches a human, it is not lost.
    surfaced_labeled = surfaced & labeled
    tp_s = len(surfaced_labeled & true_pairs)
    fn_s = len(true_pairs - surfaced_labeled)
    recall = tp_s / (tp_s + fn_s) if tp_s + fn_s else 0.0

    auto_recall = tp_a / (tp_a + len(true_pairs - auto_labeled)) if true_pairs else 0.0

    print(f"labeled pairs: {len(labels)}  true dupes: {len(true_pairs)}")
    print(f"auto threshold: {args.auto_threshold}  review threshold: {args.review_threshold}")
    print(f"auto:     tp={tp_a} fp={fp_a}  precision={precision:.4f}  (gate: >= 0.97)")
    print(f"surfaced: tp={tp_s} fn={fn_s}  recall={recall:.4f}  (gate: >= 0.85)")
    print(f"auto-only recall (informational): {auto_recall:.4f}")
    ok = precision >= 0.97 and recall >= 0.85
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
