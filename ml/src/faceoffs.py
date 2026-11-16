"""Faceoff effect study: how much team faceoff % moves goal differential.

The sim plays no individual draws; centres' `faceoffs` rating nudges attack and defence.
So the comparable number is the effect of one standard deviation of team faceoff % on
goal differential per game. The balance lab measures the same thing in the sim.

Two estimates, both observational:
- raw: goal diff/game on faceoff % alone. Good teams also have good centres, so this
  overstates the faceoff effect: treat it as an upper bound.
- controlled: adds the team's prior-season goal diff/game, which absorbs some of the
  persistent team quality. Closer to the faceoff effect, still not causal.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path

from ml.src.study import _rows, _solve


def _ols(rows: list[dict], features: tuple[str, ...]) -> tuple[list[float], list[float]]:
    """Least squares with an intercept; returns (coefficients, standard errors), intercept first."""
    x = [[1.0] + [row[key] for key in features] for row in rows]
    y = [row["target"] for row in rows]
    k = len(x[0])
    xtx = [[sum(r[i] * r[j] for r in x) for j in range(k)] for i in range(k)]
    xty = [sum(r[i] * t for r, t in zip(x, y)) for i in range(k)]
    beta = _solve(xtx, xty)
    resid = [t - sum(b * v for b, v in zip(beta, r)) for r, t in zip(x, y)]
    sigma2 = sum(e * e for e in resid) / (len(rows) - k)
    inverse = [_solve(xtx, [1.0 if i == j else 0.0 for i in range(k)]) for j in range(k)]
    return beta, [math.sqrt(sigma2 * inverse[i][i]) for i in range(k)]


def team_faceoffs(processed: Path) -> list[dict]:
    """One row per team season: faceoff %, goal diff/game, prior-season goal diff/game."""
    team_of = {(r["season"], r["player_id"]): r["team_id"]
               for r in _rows(processed / "player_seasons.csv") if r["league"] == "nhl"}
    draws: dict[tuple[int, str], list[float]] = defaultdict(lambda: [0.0, 0.0])
    for r in _rows(processed / "player_features.csv"):
        team = team_of.get((r["season"], r["player_id"]))
        if team:
            tally = draws[(int(r["season"]), team)]
            tally[0] += float(r["faceoffs_won"])
            tally[1] += float(r["faceoffs_lost"])
    teams = {(int(r["season"]), r["team_id"]): r for r in _rows(processed / "team_seasons.csv")}
    diff = {key: (int(r["goals_for"]) - int(r["goals_against"])) / int(r["games"])
            for key, r in teams.items() if int(r["games"]) > 0}
    rows = []
    for (season, team), (won, lost) in draws.items():
        if (season, team) not in diff or won + lost < 1000:
            continue
        rows.append({"season": season, "team_id": team, "faceoff_pct": won / (won + lost),
                     "target": diff[(season, team)],
                     "prior_goal_diff": diff.get((season - 1, team))})
    return rows


def study(processed: Path) -> dict:
    rows = team_faceoffs(processed)
    if len(rows) < 30:
        raise ValueError("At least 30 team seasons with faceoff data are required")
    pct = [r["faceoff_pct"] for r in rows]
    mean = sum(pct) / len(pct)
    sd = math.sqrt(sum((p - mean) ** 2 for p in pct) / (len(pct) - 1))

    def per_sd(subset: list[dict], features: tuple[str, ...]) -> dict:
        beta, se = _ols(subset, features)
        return {"team_seasons": len(subset),
                "goal_diff_per_game_per_sd": round(beta[1] * sd, 4),
                "ci95": [round((beta[1] - 1.96 * se[1]) * sd, 4),
                         round((beta[1] + 1.96 * se[1]) * sd, 4)]}

    with_prior = [r for r in rows if r["prior_goal_diff"] is not None]
    return {
        "design": __doc__.strip().splitlines()[0],
        "faceoff_pct_mean": round(mean, 4),
        "faceoff_pct_sd": round(sd, 4),
        "raw_upper_bound": per_sd(rows, ("faceoff_pct",)),
        "controlled_for_prior_goal_diff": per_sd(with_prior, ("faceoff_pct", "prior_goal_diff")),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--processed", type=Path, default=Path("ml/data/processed"))
    args = parser.parse_args()
    report = study(args.processed)
    (args.processed / "faceoff_study.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
