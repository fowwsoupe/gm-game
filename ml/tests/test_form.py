import random
import tempfile
import unittest
from pathlib import Path

from ml.src.form import study
from ml.tests.csvfile import write_csv


class FormStudyTest(unittest.TestCase):
    def test_pure_chance_gives_a_ratio_near_one(self):
        """Goals drawn exactly at their xG have no form: the ratio must be close to 1."""
        rng = random.Random(7)
        shots = []
        for game in range(3000):
            for _ in range(30):
                xg = rng.choice((0.03, 0.08, 0.2))
                shots.append({"game_id": game, "team_id": "t", "is_goal": int(rng.random() < xg),
                              "xg": xg})
        with tempfile.TemporaryDirectory() as temp:
            write_csv(Path(temp) / "shots.csv", shots)
            report = study(Path(temp))
        self.assertEqual(report["team_games"], 3000)
        self.assertAlmostEqual(report["ratio"], 1.0, delta=0.08)


if __name__ == "__main__":
    unittest.main()
