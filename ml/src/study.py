"""M1 predictive study with a season holdout and no external ML dependencies.

This is an analysis of observed NHL statistics, not a rating estimator or a
causal model. All fitted models use seasons before the latest available season.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as stream:
        return list(csv.DictReader(stream))


def solve(matrix: list[list[float]], values: list[float]) -> list[float]:
    """Small linear system with pivoting for ridge regression."""
    size = len(values)
    augmented = [row[:] + [value] for row, value in zip(matrix, values)]
    for col in range(size):
        pivot = max(range(col, size), key=lambda row: abs(augmented[row][col]))
        if abs(augmented[pivot][col]) < 1e-12:
            raise ValueError("Singular study design")
        augmented[col], augmented[pivot] = augmented[pivot], augmented[col]
        divisor = augmented[col][col]
        augmented[col] = [value / divisor for value in augmented[col]]
        for row in range(size):
            if row == col:
                continue
            factor = augmented[row][col]
            augmented[row] = [a - factor * b for a, b in
                              zip(augmented[row], augmented[col])]
    return [row[-1] for row in augmented]


def pearson(pairs: list[tuple[float, float]]) -> float:
    n = len(pairs)
    mx = sum(a for a, _ in pairs) / n
    my = sum(b for _, b in pairs) / n
    sxy = sum((a - mx) * (b - my) for a, b in pairs)
    sxx = sum((a - mx) ** 2 for a, _ in pairs)
    syy = sum((b - my) ** 2 for _, b in pairs)
    return sxy / math.sqrt(sxx * syy)


def _fit_ridge(train: list[dict], features: tuple[str, ...], alpha: float = 10):
    """Standardize on training rows only, then fit an intercept and fixed ridge penalty."""
    means = {key: sum(row[key] for row in train) / len(train) for key in features}
    scales = {key: math.sqrt(sum((row[key] - means[key]) ** 2 for row in train) /
                             len(train)) or 1 for key in features}
    target_mean = sum(row["target"] for row in train) / len(train)
    matrix = [[0.0] * len(features) for _ in features]
    values = [0.0] * len(features)
    for row in train:
        scaled = [(row[key] - means[key]) / scales[key] for key in features]
        for i, first in enumerate(scaled):
            values[i] += first * (row["target"] - target_mean)
            for j, second in enumerate(scaled):
                matrix[i][j] += first * second
    for index in range(len(features)):
        matrix[index][index] += alpha
    weights = solve(matrix, values)

    def predict(row: dict) -> float:
        return target_mean + sum(weight * (row[key] - means[key]) / scales[key]
                                 for key, weight in zip(features, weights))

    return predict


def _metrics(actual: list[float], predicted: list[float]) -> dict:
    return {
        "n": len(actual),
        "rmse": round(math.sqrt(sum((a - p) ** 2 for a, p in
                                    zip(actual, predicted)) / len(actual)), 4),
        "mae": round(sum(abs(a - p) for a, p in zip(actual, predicted)) /
                     len(actual), 4),
    }


def _evaluate(rows: list[dict], holdout: int, models: dict[str, tuple[str, ...]],
              direct: dict[str, str] | None = None) -> dict:
    train = [row for row in rows if row["season"] < holdout]
    test = [row for row in rows if row["season"] == holdout]
    if len(train) < 30 or len(test) < 20:
        return {"holdout_season": holdout, "train_rows": len(train),
                "test_rows": len(test), "models": {}, "insufficient_sample": True}
    target = [row["target"] for row in test]
    train_mean = sum(row["target"] for row in train) / len(train)
    results = {"train_mean": _metrics(target, [train_mean] * len(test))}
    for name, feature in (direct or {}).items():
        results[name] = _metrics(target, [row[feature] for row in test])
    for name, features in models.items():
        predict = _fit_ridge(train, features)
        results[name] = _metrics(target, [predict(row) for row in test])
    return {"holdout_season": holdout, "train_rows": len(train),
            "test_rows": len(test), "models": results}


def _team_pairs(path: Path) -> list[dict]:
    teams = {(int(row["season"]), row["team_id"]): row for row in read_rows(path)}
    pairs = []
    for (season, team), row in teams.items():
        later = teams.get((season + 1, team))
        if not later:
            continue
        games = int(row["games"])
        shots_for = int(row["shots_for"])
        shots_against = int(row["shots_against"])
        if min(games, shots_for, shots_against, int(later["games"])) == 0:
            continue
        pairs.append({
            "season": season,
            "target": int(later["wins"]) / int(later["games"]),
            "prior_win_pct": int(row["wins"]) / games,
            "goal_diff": (int(row["goals_for"]) - int(row["goals_against"])) / games,
            "shot_diff": (shots_for - shots_against) / games,
            "xg_diff": (float(row["xg_for"]) - float(row["xg_against"])) / games,
            "shooting_pct": int(row["goals_for"]) / shots_for,
            "save_pct": 1 - int(row["goals_against"]) / shots_against,
        })
    return pairs


def _player_pairs(path: Path) -> tuple[list[dict], list[dict]]:
    players = {(int(row["season"]), row["player_id"]): row for row in read_rows(path)}
    skaters, goalies = [], []
    for (season, player_id), row in players.items():
        later = players.get((season + 1, player_id))
        if not later or row["position"] != later["position"]:
            continue
        toi = float(row["toi_minutes"])
        later_toi = float(later["toi_minutes"])
        if row["position"] == "G":
            if min(toi, later_toi) < 1000:
                continue
            goalies.append({
                "season": season,
                "target": 60 * (float(later["goalie_xga"]) -
                                float(later["goalie_ga"])) / later_toi,
                "prior_gsax": 60 * (float(row["goalie_xga"]) -
                                    float(row["goalie_ga"])) / toi,
                "zero": 0,
            })
        elif min(toi, later_toi) >= 600:
            goals = float(row["goals"])
            xg = float(row["xg"])
            skaters.append({
                "season": season,
                "target": 60 * float(later["goals"]) / later_toi,
                "prior_goals": 60 * goals / toi,
                "xg": 60 * xg / toi,
                "finishing": 60 * (goals - xg) / toi,
                "primary_assists": 60 * float(row["primary_assists"]) / toi,
                "on_off_xg": (float(row["on_ice_xg_pct"]) -
                              float(row["off_ice_xg_pct"])),
                "hits": 60 * float(row["hits"]) / toi,
                "takeaways": 60 * float(row["takeaways"]) / toi,
            })
    return skaters, goalies


def _shot_bucket(row: dict, include_type: bool = False,
                 include_angle: bool = False) -> tuple:
    x, y = float(row["x"]), float(row["y"])
    distance = math.hypot(89 - x, y)
    distance_band = next((index for index, edge in
                          enumerate((10, 20, 30, 40, 60)) if distance < edge), 5)
    result = (distance_band,)
    if include_angle:
        angle = math.degrees(math.atan2(abs(y), abs(89 - x)))
        result += (0 if angle < 20 else 1 if angle < 40 else 2,)
    if include_type:
        result += (row["shot_type"],)
    return result


def _shot_holdout(path: Path, holdout: int) -> dict:
    train_goals = train_shots = 0
    groups = [defaultdict(lambda: [0, 0]) for _ in range(3)]
    test = []
    with path.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            season = int(row["season"])
            if season > holdout:
                continue
            goal = int(row["is_goal"])
            keys = (_shot_bucket(row), _shot_bucket(row, include_type=True),
                    _shot_bucket(row, include_type=True, include_angle=True))
            if season == holdout:
                test.append((goal, keys, float(row["xg"])))
            else:
                train_shots += 1
                train_goals += goal
                for group, key in zip(groups, keys):
                    group[key][0] += 1
                    group[key][1] += goal
    if not train_shots or not test:
        return {"holdout_season": holdout, "insufficient_sample": True}
    base_rate = train_goals / train_shots
    sums = [0.0] * 5
    for goal, keys, source_xg in test:
        predictions = [base_rate]
        for group, key in zip(groups, keys):
            n, goals = group[key]
            predictions.append((goals + 50 * base_rate) / (n + 50))
        predictions.append(source_xg)
        for index, probability in enumerate(predictions):
            sums[index] += (goal - probability) ** 2
    names = ("train_goal_rate", "distance", "distance_and_type",
             "distance_angle_and_type", "source_xg_reference")
    return {"holdout_season": holdout, "train_shots": train_shots,
            "test_shots": len(test), "brier": {
                name: round(total / len(test), 6)
                for name, total in zip(names, sums)},
            "source_xg_note": "MoneyPuck's xG is a reference, not an independent "
                              "holdout: its training seasons are unknown."}


def study(processed: Path) -> dict:
    team_rows = _team_pairs(processed / "team_seasons.csv")
    skater_rows, goalie_rows = _player_pairs(processed / "player_features.csv")
    if not team_rows:
        raise ValueError("At least two consecutive team seasons are required")
    holdout = max(row["season"] for row in team_rows)
    earlier_holdout = holdout - 1
    team_models = {
        "goal_diff": ("goal_diff",),
        "shot_diff": ("shot_diff",),
        "xg_diff": ("xg_diff",),
        "xg_plus_shooting_save": ("xg_diff", "shooting_pct", "save_pct"),
        "all": ("goal_diff", "shot_diff", "xg_diff", "shooting_pct", "save_pct"),
    }
    skater_models = {
        "prior_goals": ("prior_goals",),
        "xg": ("xg",),
        "xg_plus_finishing": ("xg", "finishing"),
        "xg_passing_on_off": ("xg", "primary_assists", "on_off_xg"),
        "all": ("xg", "finishing", "primary_assists", "on_off_xg",
                "hits", "takeaways"),
    }
    goalie_models = {"prior_gsax": ("prior_gsax",)}
    return {
        "design": "Train on earlier season pairs; evaluate the final season pair only. "
                  "Fixed ridge penalty 10, standardized on training rows. Outcomes are "
                  "next-season win percentage, skater goals/60 or goalie GSAx/60. "
                  "Observational prediction does not establish causal impact.",
        "team_next_season_wins": _evaluate(
            team_rows, holdout, team_models, {"prior_win_pct": "prior_win_pct"}),
        "skater_next_season_goals_per_60": _evaluate(
            skater_rows, holdout, skater_models),
        "goalie_next_season_gsax_per_60": _evaluate(
            goalie_rows, holdout, goalie_models, {"zero": "zero"}),
        "shots_goal_probability": _shot_holdout(processed / "shots.csv", holdout + 1),
        "earlier_rolling_check": {
            "team_next_season_wins": _evaluate(
                team_rows, earlier_holdout, team_models,
                {"prior_win_pct": "prior_win_pct"}),
            "skater_next_season_goals_per_60": _evaluate(
                skater_rows, earlier_holdout, skater_models),
            "goalie_next_season_gsax_per_60": _evaluate(
                goalie_rows, earlier_holdout, goalie_models,
                {"zero": "zero"}),
            "shots_goal_probability": _shot_holdout(
                processed / "shots.csv", earlier_holdout + 1),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--processed", type=Path, default=Path("ml/data/processed"))
    args = parser.parse_args()
    report = study(args.processed)
    (args.processed / "predictive_study.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
