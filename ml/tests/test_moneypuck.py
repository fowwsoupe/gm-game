import csv
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from ml.src.moneypuck import SHOT_COLUMNS, convert
from ml.src.pipeline import build


def csv_text(fields, rows):
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue()


class MoneyPuckTest(unittest.TestCase):
    def test_converts_a_tied_game_and_player_seasons(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            raw, staged, processed = root / "raw", root / "staged", root / "processed"
            raw.mkdir()
            common = {"season": "2025", "game_id": "g1", "isPlayoffGame": "0",
                      "homeTeamCode": "A", "awayTeamCode": "B", "homeTeamWon": "1",
                      "xCordAdjusted": "80", "yCordAdjusted": "43", "xGoal": "0.2"}
            shots = [
                {**common, "id": "1", "teamCode": "A", "shooterPlayerId": "p1",
                 "goal": "1", "shotType": "WRIST"},
                {**common, "id": "2", "teamCode": "B", "shooterPlayerId": "p2",
                 "goal": "1", "shotType": ""},
            ]
            with zipfile.ZipFile(raw / "shots_2025.zip", "w") as archive:
                archive.writestr("shots_2025.csv", csv_text(SHOT_COLUMNS, shots))
            skater = {"playerId": "p1", "season": "2025", "team": "A",
                      "position": "L", "situation": "all", "games_played": "1",
                      "icetime": "1200", "I_F_goals": "1.0",
                      "I_F_primaryAssists": "0.0", "I_F_secondaryAssists": "1.0",
                      "I_F_shotsOnGoal": "2.0", "I_F_xGoals": "0.2",
                      "I_F_hits": "1.0", "I_F_takeaways": "0.0",
                      "I_F_giveaways": "0.0", "faceoffsWon": "0.0",
                      "faceoffsLost": "0.0", "onIce_xGoalsPercentage": "0.55",
                      "offIce_xGoalsPercentage": "0.50"}
            (raw / "skaters_2025.csv").write_text(
                csv_text(tuple(skater), [skater]), encoding="utf-8")
            goalie = {"playerId": "g1", "season": "2025", "team": "A",
                      "position": "G", "situation": "all", "games_played": "1",
                      "icetime": "3600", "xGoals": "2.0", "goals": "1.0",
                      "ongoal": "20.0"}
            (raw / "goalies_2025.csv").write_text(
                csv_text(tuple(goalie), [goalie]), encoding="utf-8")

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


if __name__ == "__main__":
    unittest.main()
