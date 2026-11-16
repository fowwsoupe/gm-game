import csv
import tempfile
import unittest
from pathlib import Path

from ml.src.study import _evaluate, _shot_holdout


class StudyTest(unittest.TestCase):
    def test_future_season_cannot_enter_training_or_holdout(self):
        earlier = [{"season": 2022, "signal": float(i), "target": float(i)}
                   for i in range(30)]
        holdout = [{"season": 2023, "signal": float(i), "target": float(i)}
                   for i in range(20)]
        future = [{"season": 2024, "signal": float(i), "target": -1000.0}
                  for i in range(20)]
        expected = _evaluate(earlier + holdout, 2023, {"signal": ("signal",)})
        actual = _evaluate(earlier + holdout + future, 2023,
                           {"signal": ("signal",)})
        self.assertEqual(actual, expected)
        self.assertEqual(actual["train_rows"], 30)
        self.assertEqual(actual["test_rows"], 20)

    def test_shot_geometry_beats_base_rate_on_known_pattern(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "shots.csv"
            with path.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.DictWriter(stream,
                                        fieldnames=("season", "x", "y", "shot_type",
                                                    "is_goal", "xg"))
                writer.writeheader()
                for season in (2024, 2025):
                    for i in range(400):
                        close = i % 2 == 0
                        writer.writerow({
                            "season": season, "x": 85 if close else 20,
                            "y": 0, "shot_type": "wrist",
                            "is_goal": int(close and i % 10 < 2),
                            "xg": 0.1 if close else 0.01,
                        })
            result = _shot_holdout(path, 2025)
            self.assertEqual(result["train_shots"], 400)
            self.assertEqual(result["test_shots"], 400)
            self.assertLess(result["brier"]["distance"],
                            result["brier"]["train_goal_rate"])


if __name__ == "__main__":
    unittest.main()
