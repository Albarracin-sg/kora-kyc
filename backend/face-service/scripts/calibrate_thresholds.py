#!/usr/bin/env python3
"""Recommend face-score thresholds from an anonymized labeled CSV.

Expected columns:
    label,biometric_percent,ai_percent

The script never reads images or personal data. It only evaluates already
computed scores so threshold calibration can happen outside production.
"""
from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Score:
    same_person: bool
    biometric_percent: float
    ai_percent: float

    @property
    def combined_percent(self) -> float:
        return (self.biometric_percent + self.ai_percent) / 2


def read_scores(path: Path) -> list[Score]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = csv.DictReader(handle)
        required = {"label", "biometric_percent", "ai_percent"}
        if not rows.fieldnames or not required.issubset(rows.fieldnames):
            raise ValueError("CSV must contain label,biometric_percent,ai_percent")

        scores: list[Score] = []
        for line_number, row in enumerate(rows, start=2):
            label = (row["label"] or "").strip().lower()
            if label not in {"same_person", "different_person"}:
                raise ValueError(f"line {line_number}: invalid label")
            biometric = float(row["biometric_percent"])
            ai = float(row["ai_percent"])
            if not 0 <= biometric <= 100 or not 0 <= ai <= 100:
                raise ValueError(f"line {line_number}: scores must be between 0 and 100")
            scores.append(Score(label == "same_person", biometric, ai))

    if not scores:
        raise ValueError("CSV contains no score rows")
    return scores


def balanced_accuracy(scores: list[Score], floor: float, threshold: float) -> float:
    true_positive = false_positive = true_negative = false_negative = 0
    for score in scores:
        predicted_same = (
            score.biometric_percent >= floor and score.combined_percent > threshold
        )
        if score.same_person and predicted_same:
            true_positive += 1
        elif score.same_person:
            false_negative += 1
        elif predicted_same:
            false_positive += 1
        else:
            true_negative += 1

    positive_total = true_positive + false_negative
    negative_total = true_negative + false_positive
    if positive_total == 0 or negative_total == 0:
        return 0.0
    return 0.5 * (
        true_positive / positive_total + true_negative / negative_total
    )


def recommend(scores: list[Score]) -> dict[str, object]:
    candidates = [
        (balanced_accuracy(scores, floor, threshold), floor, threshold)
        for floor in range(0, 101)
        for threshold in range(0, 101)
    ]
    accuracy, floor, threshold = max(candidates)
    return {
        "rows": len(scores),
        "recommended_biometric_floor_percent": floor,
        "recommended_combined_threshold_percent": threshold,
        "balanced_accuracy": round(accuracy, 6),
        "policy": "biometric >= floor AND combined > threshold",
        "warning": "Validate on a representative labeled set before production use.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", type=Path)
    args = parser.parse_args()
    print(json.dumps(recommend(read_scores(args.csv_file)), indent=2))


if __name__ == "__main__":
    main()
