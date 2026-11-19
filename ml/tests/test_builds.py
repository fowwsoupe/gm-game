import random
import unittest

from ml.src.builds import cluster, year_to_year


class BuildsStudyTest(unittest.TestCase):
    def test_finds_three_planted_shapes(self):
        """Points around three far-apart centres, 50/30/20%: k = 3 with those shares."""
        rng = random.Random(0)
        centres = [[2, -2, 0, 0, 0], [-2, 2, 0, 0, 0], [0, 0, 2, -2, 0]]
        points = [[c + rng.gauss(0, 0.3) for c in centres[i]]
                  for i, n in enumerate((100, 60, 40)) for _ in range(n)]
        found = cluster(points, range(2, 6))
        self.assertEqual(found["k"], 3)
        self.assertEqual([round(c["share"], 2) for c in found["clusters"]], [0.5, 0.3, 0.2])
        self.assertAlmostEqual(found["clusters"][0]["stats"]["xg"], 2, delta=0.1)

    def test_year_to_year_pairs_consecutive_seasons(self):
        values = {(f"p{i}", 2022): i for i in range(10)}
        values |= {(f"p{i}", 2023): 2 * i + 1 for i in range(10)}
        values[("p0", 2025)] = 99.0  # no 2024 season: not paired
        self.assertEqual(year_to_year(values), {"pairs": 10, "r": 1.0})


if __name__ == "__main__":
    unittest.main()
