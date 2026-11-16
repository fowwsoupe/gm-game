import csv
import tempfile
import unittest
from pathlib import Path

from ml.src.faceoffs import study


def _write(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


class FaceoffStudyTest(unittest.TestCase):
    def test_recovers_a_known_faceoff_effect(self):
        """Goal diff/game = 10 x (faceoff % - 0.5): the per-SD effect must be 10 x SD."""
        players, features, teams = [], [], []
        for season in (2022, 2023):
            for t in range(40):
                won = 500 + 25 * t + (7 * season) % 13  # spread of faceoff % across teams
                lost = 1000 - (won - 500)
                players.append({"season": season, "player_id": f"p{t}", "league": "nhl",
                                "team_id": f"t{t}"})
                features.append({"season": season, "player_id": f"p{t}",
                                 "faceoffs_won": won, "faceoffs_lost": lost})
                diff = 10 * (won / (won + lost) - 0.5)
                teams.append({"season": season, "team_id": f"t{t}", "games": 100,
                              "goals_for": round(300 + 100 * diff), "goals_against": 300})
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            _write(root / "player_seasons.csv", players)
            _write(root / "player_features.csv", features)
            _write(root / "team_seasons.csv", teams)
            report = study(root)
        expected = 10 * report["faceoff_pct_sd"]
        self.assertAlmostEqual(report["raw_upper_bound"]["goal_diff_per_game_per_sd"],
                               expected, delta=0.01)
        self.assertEqual(report["raw_upper_bound"]["team_seasons"], 80)


if __name__ == "__main__":
    unittest.main()
