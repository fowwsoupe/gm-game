"""Descriptive M1 evidence from processed data; never infers ratings automatically."""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path

from ml.src.study import _rows


def _pearson(pairs: list[tuple[float, float]]) -> float | None:
    if len(pairs) < 30:
        return None
    xs, ys = zip(*pairs)
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    xx = sum((x - mx) ** 2 for x in xs)
    yy = sum((y - my) ** 2 for y in ys)
    if xx == 0 or yy == 0:
        return None
    return round(sum((x - mx) * (y - my) for x, y in pairs) / math.sqrt(xx * yy), 3)


def analyze(processed: Path) -> dict:
    shots = _rows(processed / "shots.csv")
    teams = _rows(processed / "team_seasons.csv")
    players = _rows(processed / "player_features.csv")
    by_distance = defaultdict(lambda: [0, 0])
    by_type = defaultdict(lambda: [0, 0])
    for shot in shots:
        distance = math.hypot(89 - float(shot["x"]), float(shot["y"]))
        bucket = "0-20" if distance < 20 else "20-40" if distance < 40 else "40+"
        for counts in (by_distance[bucket], by_type[shot["shot_type"]]):
            counts[0] += 1
            counts[1] += int(shot["is_goal"])

    def rates(groups: dict) -> dict:
        return {key: {"shots": n, "goals": goals,
                      "goal_rate": round(goals / n, 4) if n >= 100 else None}
                for key, (n, goals) in sorted(groups.items())}

    by_team = {(int(row["season"]), row["team_id"]): row for row in teams}
    features = ("goal_diff_per_game", "shot_diff_per_game", "xg_diff_per_game", "shooting_pct",
                "save_pct")
    pairs = {feature: [] for feature in features}
    for (season, team), row in by_team.items():
        later = by_team.get((season + 1, team))
        if later is None:
            continue
        games = int(row["games"])
        shots_for = int(row["shots_for"])
        shots_against = int(row["shots_against"])
        if min(games, shots_for, shots_against, int(later["games"])) == 0:
            continue
        later_win_pct = int(later["wins"]) / int(later["games"])
        values = {
            "goal_diff_per_game": (int(row["goals_for"]) - int(row["goals_against"])) / games,
            "shot_diff_per_game": (shots_for - shots_against) / games,
            "xg_diff_per_game": (float(row["xg_for"]) - float(row["xg_against"])) / games,
            "shooting_pct": int(row["goals_for"]) / shots_for,
            "save_pct": 1 - int(row["goals_against"]) / shots_against,
        }
        for feature in features:
            pairs[feature].append((values[feature], later_win_pct))

    by_player = {(int(row["season"]), row["player_id"]): row for row in players}
    skater_pairs = defaultdict(list)
    goalie_pairs = defaultdict(list)
    for (season, player_id), row in by_player.items():
        later = by_player.get((season + 1, player_id))
        if later is None or row["position"] != later["position"]:
            continue
        toi, later_toi = float(row["toi_minutes"]), float(later["toi_minutes"])
        if row["position"] != "G" and min(toi, later_toi) >= 600:
            current = {
                "xg_per_60": 60 * float(row["xg"]) / toi,
                "finishing_over_xg_per_60": 60 * (float(row["goals"]) - float(row["xg"])) / toi,
                "primary_assists_per_60": 60 * float(row["primary_assists"]) / toi,
                "hits_per_60": 60 * float(row["hits"]) / toi,
                "takeaways_per_60": 60 * float(row["takeaways"]) / toi,
                "on_off_xg_pct_gap": float(row["on_ice_xg_pct"]) -
                                      float(row["off_ice_xg_pct"]),
            }
            following = {
                "xg_per_60": 60 * float(later["xg"]) / later_toi,
                "finishing_over_xg_per_60": 60 * (float(later["goals"]) -
                                                float(later["xg"])) / later_toi,
                "primary_assists_per_60": 60 * float(later["primary_assists"]) / later_toi,
                "hits_per_60": 60 * float(later["hits"]) / later_toi,
                "takeaways_per_60": 60 * float(later["takeaways"]) / later_toi,
                "on_off_xg_pct_gap": float(later["on_ice_xg_pct"]) -
                                      float(later["off_ice_xg_pct"]),
            }
            for feature, value in current.items():
                skater_pairs[feature].append((value, following[feature]))
                skater_pairs[f"{feature}_to_next_goals_per_60"].append(
                    (value, 60 * float(later["goals"]) / later_toi)
                )
            faceoffs = float(row["faceoffs_won"]) + float(row["faceoffs_lost"])
            next_faceoffs = float(later["faceoffs_won"]) + float(later["faceoffs_lost"])
            if min(faceoffs, next_faceoffs) >= 100:
                skater_pairs["faceoff_pct"].append(
                    (float(row["faceoffs_won"]) / faceoffs,
                     float(later["faceoffs_won"]) / next_faceoffs)
                )
        elif row["position"] == "G" and min(toi, later_toi) >= 1000:
            goalie_pairs["goals_saved_above_xg_per_60"].append((
                60 * (float(row["goalie_xga"]) - float(row["goalie_ga"])) / toi,
                60 * (float(later["goalie_xga"]) - float(later["goalie_ga"])) / later_toi,
            ))

    def correlations(groups: dict) -> dict:
        return {key: {"pairs": len(values), "r": _pearson(values)}
                for key, values in sorted(groups.items())}

    report = {
        "method": "Shot goal rates are descriptive. Team correlations compare a season's "
                  "features with the same team's following-season win percentage; they "
                  "are not causal. Player correlations compare consecutive seasons for "
                  "the same player (minimum 600 skater or 1,000 goalie minutes). "
                  "Repeatability alone does not show a stat contributes to wins.",
        "shots": len(shots),
        "shot_goal_rate_by_distance_feet": rates(by_distance),
        "shot_goal_rate_by_type": rates(by_type),
        "next_season_win_pct_correlations": correlations(pairs),
        "skater_next_season_correlations": correlations(skater_pairs),
        "goalie_next_season_correlations": correlations(goalie_pairs),
        "evidence_ready": len(shots) >= 1000 and
                          all(len(values) >= 30 for values in pairs.values()),
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--processed", type=Path, default=Path("ml/data/processed"))
    args = parser.parse_args()
    report = analyze(args.processed)
    path = args.processed / "rating_evidence.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
