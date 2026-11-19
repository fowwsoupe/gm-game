import csv
import tempfile
import unittest
import zipfile
from pathlib import Path

from ml.src.moneypuck import SHOT_COLUMNS, convert
from ml.src.pipeline import DataError, build
from ml.tests.csvfile import csv_text, write_csv

SHOT = {"season": "2025", "game_id": "g1", "isPlayoffGame": "0",
        "homeTeamCode": "A", "awayTeamCode": "B", "homeTeamWon": "1",
        "xCordAdjusted": "80", "yCordAdjusted": "43", "xGoal": "0.2",
        "id": "1", "teamCode": "A", "shooterPlayerId": "p1",
        "goal": "1", "shotType": "WRIST"}
SKATER = {"playerId": "p1", "season": "2025", "team": "A",
          "position": "L", "situation": "all", "games_played": "1",
          "icetime": "1200", "I_F_goals": "1.0",
          "I_F_primaryAssists": "0.0", "I_F_secondaryAssists": "1.0",
          "I_F_shotsOnGoal": "2.0", "I_F_xGoals": "0.2",
          "I_F_hits": "1.0", "I_F_takeaways": "0.0",
          "I_F_giveaways": "0.0", "faceoffsWon": "0.0",
          "faceoffsLost": "0.0", "onIce_xGoalsPercentage": "0.55",
          "offIce_xGoalsPercentage": "0.50"}
GOALIE = {"playerId": "g1", "season": "2025", "team": "A",
          "position": "G", "situation": "all", "games_played": "1",
          "icetime": "3600", "xGoals": "2.0", "goals": "1.0",
          "ongoal": "20.0"}


def write_raw(raw: Path, shots: list[dict], skater: dict) -> None:
    """A MoneyPuck download for 2025: zipped shots plus one skater and one goalie file."""
    raw.mkdir()
    with zipfile.ZipFile(raw / "shots_2025.zip", "w") as archive:
        archive.writestr("shots_2025.csv", csv_text(shots, SHOT_COLUMNS))
    write_csv(raw / "skaters_2025.csv", [skater])
    write_csv(raw / "goalies_2025.csv", [GOALIE])


class MoneyPuckTest(unittest.TestCase):
    def test_converts_a_tied_game_and_player_seasons(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            raw, staged, processed = root / "raw", root / "staged", root / "processed"
            write_raw(raw, [SHOT, {**SHOT, "id": "2", "teamCode": "B", "shooterPlayerId": "p2",
                                   "shotType": ""}], SKATER)
            result = convert(raw, staged, [2025])
            self.assertEqual(result["games_decided_after_tied_goals"], 1)
            self.assertEqual(result["rounded_y_coordinates_clamped"], 2)
            summary = build(staged, processed)
            self.assertEqual(summary["rows"]["shots"], 2)
            with (processed / "games.csv").open(newline="") as stream:
                game = next(csv.DictReader(stream))
            self.assertEqual(game["home_won"], "1")
            with (processed / "player_seasons.csv").open(newline="") as stream:
                players = {row["player_id"]: row for row in csv.DictReader(stream)}
            self.assertEqual(players["p1"]["position"], "LW")
            self.assertEqual(players["p1"]["toi_minutes"], "20.0")
            self.assertEqual(players["g1"]["goals"], "0")

    def test_a_download_missing_a_feature_column_fails_with_a_clear_error(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            raw = root / "raw"
            # A skater file stopping before the feature columns (xG, hits, faceoffs...).
            skater = {k: SKATER[k] for k in list(SKATER)[:11]}
            write_raw(raw, [{**SHOT, "yCordAdjusted": "10"}], skater)
            with self.assertRaisesRegex(DataError, "missing columns.*faceoffsWon"):
                convert(raw, root / "staged", [2025])


if __name__ == "__main__":
    unittest.main()
