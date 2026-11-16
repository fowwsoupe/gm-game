import csv
import random
import tempfile
import unittest
from pathlib import Path

from ml.src.form import study


class FormStudyTest(unittest.TestCase):
    def test_pure_chance_gives_a_ratio_near_one(self):
        """Goals drawn exactly at their xG have no form: the ratio must be close to 1."""
        rng = random.Random(7)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "shots.csv"
            with path.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.DictWriter(stream, fieldnames=("game_id", "team_id", "is_goal", "xg"))
                writer.writeheader()
                for game in range(3000):
                    for _ in range(30):
                        xg = rng.choice((0.03, 0.08, 0.2))
                        writer.writerow({"game_id": game, "team_id": "t", "xg": xg,
                                         "is_goal": int(rng.random() < xg)})
            report = study(Path(temp))
        self.assertEqual(report["team_games"], 3000)
        self.assertAlmostEqual(report["ratio"], 1.0, delta=0.08)


if __name__ == "__main__":
    unittest.main()
