"""Per-game form study: how much a team game's goals vary around expected goals beyond chance.

For each team game, goals minus the sum of shot xG is compared with the variance pure chance
gives (sum of xG x (1 - xG)). The ratio above 1 is per-game "form": goalie form, finishing
streaks and xG model misses together, so it is a ceiling for the sim's goalie form. The
balance lab's "Goals vs expected, variance ratio" check measures the same number in the sim.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from ml.src.study import _rows


def study(processed: Path) -> dict:
    games: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    for row in _rows(processed / "shots.csv"):
        xg = float(row["xg"])
        tally = games[(row["game_id"], row["team_id"])]
        tally[0] += int(row["is_goal"])
        tally[1] += xg
        tally[2] += xg * (1 - xg)
    if len(games) < 100:
        raise ValueError("At least 100 team games with shots are required")
    resid = [goals - xg for goals, xg, _ in games.values()]
    mean = sum(resid) / len(resid)
    observed = sum((e - mean) ** 2 for e in resid) / (len(resid) - 1)
    chance = sum(v for _, _, v in games.values()) / len(games)
    return {
        "design": __doc__.strip().splitlines()[0],
        "team_games": len(games),
        "variance_goals_minus_xg": round(observed, 4),
        "variance_from_chance": round(chance, 4),
        "ratio": round(observed / chance, 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--processed", type=Path, default=Path("ml/data/processed"))
    args = parser.parse_args()
    report = study(args.processed)
    (args.processed / "form_study.json").write_text(json.dumps(report, indent=2) + "\n",
                                                     encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
