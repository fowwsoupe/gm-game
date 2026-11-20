import json
import sqlite3
import unittest

from ml.src.playtest import analyze


class PlaytestTest(unittest.TestCase):
    def test_counts_user_actions_and_flags_idle_seasons(self):
        db = sqlite3.connect(":memory:")
        db.execute("CREATE TABLE teams (id TEXT, user_controlled INTEGER)")
        db.execute("CREATE TABLE events (seq INTEGER PRIMARY KEY, season INTEGER, kind TEXT,"
                   " team_ids TEXT, payload_json TEXT)")
        db.executemany("INSERT INTO teams VALUES (?, ?)", [("a", 1), ("b", 0)])
        rows = [
            (2026, "lines.set", ["a"], {}),
            (2026, "trade.completed", ["a", "b"], {}),
            (2026, "lines.set", ["b"], {}),  # another team's action: not counted
            (2026, "owner.confidenceMoved", ["a"], {"confidence": 60}),
            (2027, "game.final", ["a", "b"], {}),  # sim event, no user action
            (2027, "owner.confidenceMoved", ["a"], {"confidence": 40}),
            (2027, "owner.frustrated", ["a"], {}),
            (2027, "champion.crowned", ["a"], {}),
        ]
        db.executemany("INSERT INTO events (season, kind, team_ids, payload_json)"
                       " VALUES (?, ?, ?, ?)", [(s, k, json.dumps(t), json.dumps(p))
                                                for s, k, t, p in rows])
        team = analyze(db)["teams"]["a"]
        self.assertEqual(team["actions_per_season"], {2026: 2, 2027: 0})
        self.assertEqual(team["idle_seasons"], [2027])
        self.assertEqual(team["owner_confidence"], {"start": 60, "end": 40, "low": 40})
        self.assertEqual((team["owner_frustrated"], team["titles"]), (1, 1))


if __name__ == "__main__":
    unittest.main()
