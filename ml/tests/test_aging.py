import tempfile
import unittest
from pathlib import Path

from ml.src.aging import study
from ml.tests.csvfile import write_csv


def rate(age: int) -> float:
    """Points/60: +0.05 a year to 24, flat to 29, -0.05 a year from 30."""
    return 1.0 + 0.05 * (min(age, 24) - 19) - 0.05 * max(0, age - 29)


class AgingStudyTest(unittest.TestCase):
    def test_recovers_a_known_aging_curve(self):
        """Every season holds the same ages, so each band's change is exact: +-0.25 over 5.625."""
        seasons, births = [], []
        for born in range(1988, 2007):
            for copy in range(3):
                player = f"p{born}{copy}"
                births.append({"playerId": player, "birthDate": f"{born}-06-15"})
                for season in range(2022, 2026):
                    if 19 <= season - born <= 34:
                        seasons.append({"season": season, "player_id": player, "league": "nhl",
                                        "position": "C", "goals": round(100 * rate(season - born)),
                                        "assists": 0, "toi_minutes": 6000})
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_csv(root / "player_seasons.csv", seasons)
            write_csv(root / "lookup.csv", births)
            bands = study(root, root / "lookup.csv")["bands"]
        self.assertAlmostEqual(bands["18-24"]["pct_per_year"], 4.44, delta=0.01)
        self.assertAlmostEqual(bands["25-29"]["pct_per_year"], 0, delta=0.01)
        self.assertAlmostEqual(bands["30-34"]["pct_per_year"], -4.44, delta=0.01)
        self.assertEqual(bands["30-34"]["pairs"], 45)


if __name__ == "__main__":
    unittest.main()
