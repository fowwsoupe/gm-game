"""Convert MoneyPuck's published season downloads into the local M1 CSV contract.

Use only files downloaded from https://moneypuck.com/data.htm. Outputs are for an
internal prototype; commercial training/shipping rights have not been confirmed.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from collections import Counter
from pathlib import Path

from .pipeline import DataError, TABLES


SHOT_COLUMNS = (
    "season", "game_id", "id", "isPlayoffGame", "homeTeamCode",
    "awayTeamCode", "homeTeamWon", "teamCode", "shooterPlayerId", "goal",
    "xCordAdjusted", "yCordAdjusted", "shotType", "xGoal"
)

# Columns the player-features table reads, so a changed download fails with a clear message
# instead of a KeyError traceback.
FEATURE_COLUMNS = {
    "skaters": ("I_F_goals", "I_F_xGoals", "I_F_primaryAssists", "I_F_hits",
                "I_F_takeaways", "I_F_giveaways", "faceoffsWon", "faceoffsLost",
                "onIce_xGoalsPercentage", "offIce_xGoalsPercentage"),
    "goalies": ("xGoals", "goals", "ongoal"),
}


def _reader(stream, required: tuple[str, ...], label: str):
    reader = csv.DictReader(stream)
    missing = set(required) - set(reader.fieldnames or ())
    if missing:
        raise DataError(f"{label}: missing columns {', '.join(sorted(missing))}")
    return reader


def _whole(value: str, label: str) -> int:
    try:
        number = float(value)
    except ValueError as exc:
        raise DataError(f"{label}: expected whole number, got {value!r}") from exc
    if number < 0 or number != int(number):
        raise DataError(f"{label}: expected nonnegative whole number, got {value!r}")
    return int(number)


def convert(raw: Path, staged: Path, seasons: list[int]) -> dict:
    if not seasons or len(seasons) != len(set(seasons)):
        raise DataError("Specify distinct seasons")
    staged.mkdir(parents=True, exist_ok=True)
    game_data = {}
    counts = Counter()
    source_urls = []

    with (staged / "shots.csv").open("w", newline="", encoding="utf-8") as out:
        writer = csv.DictWriter(out, fieldnames=TABLES["shots"])
        writer.writeheader()
        for season in sorted(seasons):
            path = raw / f"shots_{season}.zip"
            try:
                archive = zipfile.ZipFile(path)
            except (FileNotFoundError, zipfile.BadZipFile) as exc:
                raise DataError(f"Missing or invalid {path}") from exc
            source_urls.append(
                f"https://peter-tanner.com/moneypuck/downloads/shots_{season}.zip"
            )
            with archive, archive.open(f"shots_{season}.csv") as source:
                rows = _reader(io.TextIOWrapper(source, encoding="utf-8-sig"),
                               SHOT_COLUMNS, str(path))
                for row in rows:
                    if row["isPlayoffGame"] == "1":
                        continue
                    if row["season"] != str(season):
                        raise DataError(f"{path}: unexpected season {row['season']}")
                    home, away = row["homeTeamCode"], row["awayTeamCode"]
                    team = row["teamCode"]
                    if team not in (home, away):
                        raise DataError(f"{path}: shot team {team} not in game")
                    key = (season, row["game_id"])
                    game = game_data.setdefault(key, {
                        "home": home, "away": away, "source_home_won": row["homeTeamWon"],
                        "goals": Counter()
                    })
                    if (game["home"], game["away"], game["source_home_won"]) != (
                            home, away, row["homeTeamWon"]):
                        raise DataError(f"{path}: inconsistent game metadata for {key}")
                    if row["goal"] == "1":
                        game["goals"][team] += 1
                    shooter = row["shooterPlayerId"]
                    if not shooter:
                        shooter = f"unknown:{season}:{row['game_id']}:{row['id']}"
                        counts["shots_without_shooter_id"] += 1
                    y = float(row["yCordAdjusted"])
                    if 42.5 < abs(y) <= 43:
                        y = 42.5 if y > 0 else -42.5
                        counts["rounded_y_coordinates_clamped"] += 1
                    writer.writerow({
                        "season": season, "game_id": row["game_id"],
                        "event_id": row["id"], "team_id": team,
                        "shooter_id": shooter,
                        "is_goal": row["goal"], "x": row["xCordAdjusted"],
                        "y": y,
                        "shot_type": row["shotType"].lower() or "unknown",
                        "xg": row["xGoal"],
                    })
                    counts["shots"] += 1

    with (staged / "games.csv").open("w", newline="", encoding="utf-8") as out:
        writer = csv.DictWriter(out, fieldnames=TABLES["games"])
        writer.writeheader()
        for (season, game_id), game in sorted(game_data.items()):
            home_goals = game["goals"][game["home"]]
            away_goals = game["goals"][game["away"]]
            source_won = game["source_home_won"] == "1"
            home_won = source_won if home_goals == away_goals else home_goals > away_goals
            if home_goals == away_goals:
                counts["games_decided_after_tied_goals"] += 1
            elif home_won != source_won:
                counts["source_winner_disagreements"] += 1
            writer.writerow({
                "season": season, "game_id": game_id,
                "home_team_id": game["home"], "away_team_id": game["away"],
                "home_goals": home_goals, "away_goals": away_goals,
                "home_won": int(home_won),
            })
            counts["games"] += 1

    with (staged / "player_seasons.csv").open("w", newline="", encoding="utf-8") as out:
        writer = csv.DictWriter(out, fieldnames=TABLES["player_seasons"])
        writer.writeheader()
        for season in sorted(seasons):
            for kind in ("skaters", "goalies"):
                path = raw / f"{kind}_{season}.csv"
                try:
                    stream = path.open(newline="", encoding="utf-8-sig")
                except FileNotFoundError as exc:
                    raise DataError(f"Missing {path}") from exc
                source_urls.append(
                    f"https://moneypuck.com/moneypuck/playerData/seasonSummary/"
                    f"{season}/regular/{kind}.csv"
                )
                required = ("playerId", "season", "team", "position", "situation",
                            "games_played", "icetime")
                if kind == "skaters":
                    required += ("I_F_goals", "I_F_primaryAssists",
                                 "I_F_secondaryAssists", "I_F_shotsOnGoal")
                with stream:
                    for row in _reader(stream, required, str(path)):
                        if row["situation"] != "all":
                            continue
                        if row["season"] != str(season):
                            raise DataError(f"{path}: unexpected season {row['season']}")
                        position = {"L": "LW", "R": "RW"}.get(row["position"],
                                                               row["position"])
                        if kind == "skaters":
                            goals = _whole(row["I_F_goals"], "I_F_goals")
                            assists = (_whole(row["I_F_primaryAssists"], "primary assists") +
                                       _whole(row["I_F_secondaryAssists"], "secondary assists"))
                            shots = _whole(row["I_F_shotsOnGoal"], "shots on goal")
                        else:
                            goals = assists = shots = 0
                        writer.writerow({
                            "season": season, "player_id": row["playerId"],
                            "league": "nhl", "team_id": row["team"],
                            "position": position,
                            "games": _whole(row["games_played"], "games played"),
                            "goals": goals, "assists": assists, "shots": shots,
                            "toi_minutes": round(float(row["icetime"]) / 60, 3),
                        })
                        counts["player_seasons"] += 1

    with (staged / "player_features.csv").open("w", newline="", encoding="utf-8") as out:
        writer = csv.DictWriter(out, fieldnames=TABLES["player_features"])
        writer.writeheader()
        for season in sorted(seasons):
            for kind in ("skaters", "goalies"):
                path = raw / f"{kind}_{season}.csv"
                required = ("playerId", "season", "position", "situation", "icetime")
                required += FEATURE_COLUMNS[kind]
                with path.open(newline="", encoding="utf-8-sig") as stream:
                    for row in _reader(stream, required, str(path)):
                        if row["situation"] != "all":
                            continue
                        position = {"L": "LW", "R": "RW"}.get(row["position"],
                                                               row["position"])
                        features = {field: 0 for field in TABLES["player_features"][5:]}
                        if kind == "skaters":
                            features.update({
                                "goals": row["I_F_goals"],
                                "xg": row["I_F_xGoals"],
                                "primary_assists": row["I_F_primaryAssists"],
                                "hits": row["I_F_hits"],
                                "takeaways": row["I_F_takeaways"],
                                "giveaways": row["I_F_giveaways"],
                                "faceoffs_won": row["faceoffsWon"],
                                "faceoffs_lost": row["faceoffsLost"],
                                "on_ice_xg_pct": row["onIce_xGoalsPercentage"],
                                "off_ice_xg_pct": row["offIce_xGoalsPercentage"],
                            })
                        else:
                            features.update({
                                "goalie_xga": row["xGoals"],
                                "goalie_ga": row["goals"],
                                "goalie_shots_against": row["ongoal"],
                            })
                        writer.writerow({
                            "season": season, "player_id": row["playerId"],
                            "league": "nhl", "position": position,
                            "toi_minutes": round(float(row["icetime"]) / 60, 3),
                            **features,
                        })
                        counts["player_features"] += 1

    for name in ("drafts", "contracts"):
        with (staged / f"{name}.csv").open("w", newline="", encoding="utf-8") as out:
            csv.writer(out).writerow(TABLES[name])
    (staged / "source.json").write_text(json.dumps({
        "source": "MoneyPuck published downloads",
        "rights_note": "Internal prototype only. Commercial ML training and shipped-model "
                       "rights to be reviewed before use in a commercial game.",
        "source_urls": source_urls,
        "coverage_note": "NHL only; no junior/European seasons, drafts, or contracts",
    }, indent=2) + "\n", encoding="utf-8")
    return dict(sorted(counts.items()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, default=Path("ml/data/raw/moneypuck"))
    parser.add_argument("--staged", type=Path, default=Path("ml/data/raw/normalized"))
    parser.add_argument("--seasons", nargs="+", type=int, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(convert(args.raw, args.staged, args.seasons), indent=2))
    except DataError as exc:
        parser.exit(1, f"MoneyPuck import error: {exc}\n")


if __name__ == "__main__":
    main()
