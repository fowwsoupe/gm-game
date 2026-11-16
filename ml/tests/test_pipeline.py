import csv
import json
import tempfile
import unittest
from pathlib import Path

from ml.src.analyze import analyze
from ml.src.pipeline import DataError, TABLES, build


def write_table(path, name, rows):
    with (path / f"{name}.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=TABLES[name])
        writer.writeheader()
        writer.writerows(rows)


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.raw = Path(self.temp.name) / "raw"
        self.processed = Path(self.temp.name) / "processed"
        self.raw.mkdir()
        (self.raw / "source.json").write_text(json.dumps({
            "source": "synthetic test fixture",
            "rights_note": "Created for this test; no third-party data",
        }), encoding="utf-8")
        self.games = [{"season": "2025", "game_id": "g1", "home_team_id": "A",
                       "away_team_id": "B", "home_goals": "2", "away_goals": "1",
                       "home_won": "1"}]
        write_table(self.raw, "games", self.games)
        write_table(self.raw, "shots", [
            {"season": "2025", "game_id": "g1", "event_id": "1", "team_id": "A",
             "shooter_id": "p1", "is_goal": "1", "x": "80", "y": "1",
             "shot_type": "wrist", "xg": "0.2"},
            {"season": "2025", "game_id": "g1", "event_id": "2", "team_id": "B",
             "shooter_id": "p2", "is_goal": "0", "x": "70", "y": "2",
             "shot_type": "snap", "xg": "0.1"},
        ])
        write_table(self.raw, "player_seasons", [
            {"season": "2025", "player_id": "p1", "league": "nhl", "team_id": "A",
             "position": "C", "games": "1", "goals": "1", "assists": "0",
             "shots": "1", "toi_minutes": "19.5"},
            {"season": "2025", "player_id": "p3", "league": "junior", "team_id": "J",
             "position": "D", "games": "3", "goals": "0", "assists": "2",
             "shots": "4", "toi_minutes": "50"},
            {"season": "2025", "player_id": "p4", "league": "europe", "team_id": "E",
             "position": "G", "games": "4", "goals": "0", "assists": "0",
             "shots": "0", "toi_minutes": "200"},
        ])
        write_table(self.raw, "player_features", [{
            "season": "2025", "player_id": "p1", "league": "nhl",
            "position": "C", "toi_minutes": "19.5", "goals": "1", "xg": "0.2",
            "primary_assists": "0", "hits": "2", "takeaways": "1",
            "giveaways": "1", "faceoffs_won": "3", "faceoffs_lost": "2",
            "on_ice_xg_pct": "0.55", "off_ice_xg_pct": "0.5",
            "goalie_xga": "0", "goalie_ga": "0", "goalie_shots_against": "0",
        }])
        write_table(self.raw, "drafts", [{"draft_year": "2025", "player_id": "p3",
                                          "round": "1", "overall": "2", "team_id": "A"}])
        write_table(self.raw, "contracts", [
            {"season": "2025", "player_id": "p1", "team_id": "A",
             "cap_hit": "1000000", "expires_after_season": "2027"},
        ])

    def test_builds_all_tables_and_descriptive_report(self):
        summary = build(self.raw, self.processed)
        self.assertEqual(summary["leagues"], {"europe": 1, "junior": 1, "nhl": 1})
        self.assertEqual(summary["rows"]["team_seasons"], 2)
        with (self.processed / "team_seasons.csv").open(newline="") as stream:
            teams = {row["team_id"]: row for row in csv.DictReader(stream)}
        self.assertEqual(teams["A"]["wins"], "1")
        self.assertEqual(teams["B"]["shots_against"], "1")
        self.assertEqual(float(teams["A"]["xg_for"]), 0.2)
        report = analyze(self.processed)
        self.assertFalse(report["evidence_ready"])
        self.assertIsNone(report["shot_goal_rate_by_type"]["wrist"]["goal_rate"])

    def test_rejects_broken_references_before_writing_output(self):
        with (self.raw / "shots.csv").open(newline="") as stream:
            rows = list(csv.DictReader(stream))
        rows[0]["team_id"] = "UNKNOWN"
        write_table(self.raw, "shots", rows)
        with self.assertRaisesRegex(DataError, "unknown game/team"):
            build(self.raw, self.processed)
        self.assertFalse(self.processed.exists())

    def test_rejects_duplicate_event_ids(self):
        with (self.raw / "shots.csv").open(newline="") as stream:
            rows = list(csv.DictReader(stream))
        rows[1]["event_id"] = "1"
        write_table(self.raw, "shots", rows)
        with self.assertRaisesRegex(DataError, "duplicate"):
            build(self.raw, self.processed)

    def test_zero_shot_teams_have_numeric_totals(self):
        write_table(self.raw, "shots", [])
        build(self.raw, self.processed)
        with (self.processed / "team_seasons.csv").open(newline="") as stream:
            teams = list(csv.DictReader(stream))
        self.assertTrue(all(row["shots_for"] == "0" for row in teams))
        self.assertFalse(analyze(self.processed)["evidence_ready"])

    def test_uses_winner_when_recorded_goals_are_tied(self):
        self.games[0]["home_goals"] = "2"
        self.games[0]["away_goals"] = "2"
        self.games[0]["home_won"] = "0"
        write_table(self.raw, "games", self.games)
        build(self.raw, self.processed)
        with (self.processed / "team_seasons.csv").open(newline="") as stream:
            teams = {row["team_id"]: row for row in csv.DictReader(stream)}
        self.assertEqual(teams["A"]["wins"], "0")
        self.assertEqual(teams["B"]["wins"], "1")

    def test_requires_provenance(self):
        (self.raw / "source.json").unlink()
        with self.assertRaisesRegex(DataError, "manifest required"):
            build(self.raw, self.processed)


if __name__ == "__main__":
    unittest.main()
