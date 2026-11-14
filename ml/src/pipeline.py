"""Validate staged hockey CSVs and build the M1 analysis dataset.

This module deliberately has no downloader. Record each source's rights status in
source.json; the game never ships these files or their outputs.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
from collections import defaultdict
from pathlib import Path
from tempfile import NamedTemporaryFile


TABLES = {
    "games": (
        "season", "game_id", "home_team_id", "away_team_id", "home_goals",
        "away_goals", "home_won"
    ),
    "shots": (
        "season", "game_id", "event_id", "team_id", "shooter_id", "is_goal",
        "x", "y", "shot_type", "xg"
    ),
    "player_seasons": (
        "season", "player_id", "league", "team_id", "position", "games",
        "goals", "assists", "shots", "toi_minutes"
    ),
    "player_features": (
        "season", "player_id", "league", "position", "toi_minutes", "goals",
        "xg", "primary_assists", "hits", "takeaways", "giveaways",
        "faceoffs_won", "faceoffs_lost", "on_ice_xg_pct", "off_ice_xg_pct",
        "goalie_xga", "goalie_ga", "goalie_shots_against"
    ),
    "drafts": ("draft_year", "player_id", "round", "overall", "team_id"),
    "contracts": (
        "season", "player_id", "team_id", "cap_hit", "expires_after_season"
    ),
}


class DataError(ValueError):
    """An input file does not meet the M1 data contract."""


def _integer(value: str, where: str, minimum: int = 0) -> int:
    try:
        number = int(value)
    except (ValueError, TypeError) as exc:
        raise DataError(f"{where}: expected integer, got {value!r}") from exc
    if number < minimum:
        raise DataError(f"{where}: must be at least {minimum}")
    return number


def _decimal(value: str, where: str) -> float:
    try:
        number = float(value)
    except (ValueError, TypeError) as exc:
        raise DataError(f"{where}: expected number, got {value!r}") from exc
    if not math.isfinite(number):
        raise DataError(f"{where}: expected finite number")
    return number


def _read_table(raw: Path, name: str) -> list[dict[str, str]]:
    path = raw / f"{name}.csv"
    try:
        with path.open(newline="", encoding="utf-8-sig") as stream:
            reader = csv.DictReader(stream)
            missing = set(TABLES[name]) - set(reader.fieldnames or ())
            if missing:
                raise DataError(f"{path}: missing columns {', '.join(sorted(missing))}")
            rows = []
            for line, row in enumerate(reader, 2):
                if None in row:
                    raise DataError(f"{path}:{line}: extra CSV fields")
                clean = {key: (row[key] or "").strip() for key in TABLES[name]}
                for key, value in clean.items():
                    if not value:
                        raise DataError(f"{path}:{line}: empty {key}")
                rows.append(clean)
            return rows
    except FileNotFoundError as exc:
        raise DataError(f"Missing input {path}") from exc


def _unique(rows: list[dict[str, str]], fields: tuple[str, ...], table: str) -> None:
    seen = set()
    for index, row in enumerate(rows, 2):
        key = tuple(row[field] for field in fields)
        if key in seen:
            raise DataError(f"{table}.csv:{index}: duplicate {fields}: {key}")
        seen.add(key)


def _validate(tables: dict[str, list[dict[str, str]]]) -> None:
    games = tables["games"]
    if not games:
        raise DataError("games.csv: at least one game is required")
    _unique(games, ("season", "game_id"), "games")
    game_teams = {}
    for row in games:
        season = _integer(row["season"], "games.season", 1900)
        if season > 2100:
            raise DataError("games.season: must be at most 2100")
        for key in ("home_goals", "away_goals"):
            _integer(row[key], f"games.{key}")
        if row["home_won"] not in ("0", "1"):
            raise DataError("games.home_won: expected 0 or 1")
        if row["home_team_id"] == row["away_team_id"]:
            raise DataError("games.csv: home and away team must differ")
        game_teams[(row["season"], row["game_id"])] = {
            row["home_team_id"], row["away_team_id"]
        }

    _unique(tables["shots"], ("season", "game_id", "event_id"), "shots")
    for row in tables["shots"]:
        key = (row["season"], row["game_id"])
        if key not in game_teams or row["team_id"] not in game_teams[key]:
            raise DataError(f"shots.csv: unknown game/team {key}, {row['team_id']}")
        if row["is_goal"] not in ("0", "1"):
            raise DataError("shots.is_goal: expected 0 or 1")
        if not 0 <= _decimal(row["x"], "shots.x") <= 100:
            raise DataError("shots.x: expected 0..100, attacking toward x=89")
        if not -42.5 <= _decimal(row["y"], "shots.y") <= 42.5:
            raise DataError("shots.y: expected -42.5..42.5")
        if not 0 <= _decimal(row["xg"], "shots.xg") <= 1:
            raise DataError("shots.xg: expected probability 0..1")

    _unique(tables["player_seasons"], ("season", "player_id", "league", "team_id"),
            "player_seasons")
    for row in tables["player_seasons"]:
        _integer(row["season"], "player_seasons.season", 1900)
        if row["league"] not in ("nhl", "junior", "europe"):
            raise DataError("player_seasons.league: expected nhl, junior, or europe")
        if row["position"] not in ("C", "LW", "RW", "D", "G"):
            raise DataError("player_seasons.position: invalid hockey position")
        for field in ("games", "goals", "assists", "shots"):
            _integer(row[field], f"player_seasons.{field}")
        if _decimal(row["toi_minutes"], "player_seasons.toi_minutes") < 0:
            raise DataError("player_seasons.toi_minutes: must be nonnegative")

    _unique(tables["player_features"], ("season", "player_id", "league"),
            "player_features")
    for row in tables["player_features"]:
        if row["league"] not in ("nhl", "junior", "europe"):
            raise DataError("player_features.league: invalid league")
        if row["position"] not in ("C", "LW", "RW", "D", "G"):
            raise DataError("player_features.position: invalid position")
        _integer(row["season"], "player_features.season", 1900)
        for field in TABLES["player_features"][4:]:
            value = _decimal(row[field], f"player_features.{field}")
            if value < 0:
                raise DataError(f"player_features.{field}: must be nonnegative")
        for field in ("on_ice_xg_pct", "off_ice_xg_pct"):
            if float(row[field]) > 1:
                raise DataError(f"player_features.{field}: expected 0..1")

    _unique(tables["drafts"], ("draft_year", "player_id"), "drafts")
    for row in tables["drafts"]:
        for field, minimum in (("draft_year", 1900), ("round", 1), ("overall", 1)):
            _integer(row[field], f"drafts.{field}", minimum)

    _unique(tables["contracts"], ("season", "player_id", "team_id"), "contracts")
    for row in tables["contracts"]:
        season = _integer(row["season"], "contracts.season", 1900)
        _integer(row["cap_hit"], "contracts.cap_hit")
        if _integer(row["expires_after_season"], "contracts.expires_after_season") < season:
            raise DataError("contracts.expires_after_season: earlier than season")


def _team_seasons(games: list[dict[str, str]], shots: list[dict[str, str]]) -> list[dict]:
    totals = defaultdict(lambda: defaultdict(int))
    opponents = {}
    for game in games:
        season = game["season"]
        home = game["home_team_id"]
        away = game["away_team_id"]
        home_goals = int(game["home_goals"])
        away_goals = int(game["away_goals"])
        opponents[(season, game["game_id"], home)] = away
        opponents[(season, game["game_id"], away)] = home
        home_won = game["home_won"] == "1"
        for team, scored, allowed, won in ((home, home_goals, away_goals, home_won),
                                           (away, away_goals, home_goals, not home_won)):
            stats = totals[(season, team)]
            stats["games"] += 1
            stats["wins"] += int(won)
            stats["goals_for"] += scored
            stats["goals_against"] += allowed
    for shot in shots:
        key = (shot["season"], shot["team_id"])
        totals[key]["shots_for"] += 1
        totals[key]["xg_for"] += float(shot["xg"])
        opponent = opponents[(shot["season"], shot["game_id"], shot["team_id"])]
        totals[(shot["season"], opponent)]["shots_against"] += 1
        totals[(shot["season"], opponent)]["xg_against"] += float(shot["xg"])
    fields = ("games", "wins", "goals_for", "goals_against", "shots_for",
              "shots_against", "xg_for", "xg_against")
    return [dict(season=season, team_id=team,
                 **{field: stats[field] for field in fields})
            for (season, team), stats in sorted(totals.items())]


def _write_csv(path: Path, fields: tuple[str, ...], rows: list[dict]) -> None:
    with NamedTemporaryFile("w", newline="", encoding="utf-8", dir=path.parent,
                            delete=False) as stream:
        temporary = Path(stream.name)
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    os.replace(temporary, path)


def build(raw: Path, processed: Path) -> dict:
    """Build normalized CSVs and a team-season table; fail before changing outputs."""
    manifest_path = raw / "source.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        raise DataError(f"{manifest_path}: valid source manifest required") from exc
    if not isinstance(manifest, dict):
        raise DataError(f"{manifest_path}: expected JSON object")
    for key in ("source", "rights_note"):
        if not isinstance(manifest.get(key), str) or not manifest[key].strip():
            raise DataError(f"{manifest_path}: nonempty {key} required")
    tables = {name: _read_table(raw, name) for name in TABLES}
    _validate(tables)
    teams = _team_seasons(tables["games"], tables["shots"])
    processed.mkdir(parents=True, exist_ok=True)
    for name, fields in TABLES.items():
        _write_csv(processed / f"{name}.csv", fields, tables[name])
    team_fields = ("season", "team_id", "games", "wins", "goals_for",
                   "goals_against", "shots_for", "shots_against", "xg_for", "xg_against")
    _write_csv(processed / "team_seasons.csv", team_fields, teams)
    summary = {"source": manifest["source"], "rights_note": manifest["rights_note"],
               "rows": {**{name: len(rows) for name, rows in tables.items()},
                        "team_seasons": len(teams)},
               "leagues": dict(sorted({league: sum(row["league"] == league for row in
                                               tables["player_seasons"])
                                       for league in ("nhl", "junior", "europe")}.items()))}
    (processed / "summary.json").write_text(json.dumps(summary, indent=2) + "\n",
                                            encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, default=Path("ml/data/raw"))
    parser.add_argument("--processed", type=Path, default=Path("ml/data/processed"))
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.raw, args.processed), indent=2))
    except DataError as exc:
        parser.exit(1, f"M1 data error: {exc}\n")


if __name__ == "__main__":
    main()
