"""Playtest analysis: what a human did in a save and how it went, from the save's event log.

Reads a save file (SQLite, `events` and `teams` tables) with the standard library only and
prints JSON per user-controlled team: user actions per season by kind (events whose kind is
in USER_KINDS and that name the team), owner confidence start, end and low, owner
frustration count, titles, and seasons with no user action at all (a sign the player
skipped through or got stuck). Run on playtesters' saves and compare the flags.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter, defaultdict
from contextlib import closing

# Commands a human issues; sim-only events (game.final, players.developed...) are left out.
USER_KINDS = {
    "lines.set", "units.set", "training.planSet", "trade.blockSet", "goalies.rotationSet",
    "draft.boardSet", "trade.completed", "player.signed", "contract.extended",
    "contract.boughtOut", "freeAgency.offered", "contract.countered", "owner.cardAnswered",
    "finance.ticketPriceSet", "prospect.signed", "prospect.released", "delegate.set",
    "bench.ordered", "staff.hired", "staff.fired",
}


def analyze(db: sqlite3.Connection) -> dict:
    teams = [r[0] for r in db.execute("SELECT id FROM teams WHERE user_controlled = 1")]
    seasons = sorted(r[0] for r in db.execute("SELECT DISTINCT season FROM events"))
    report: dict = {"seasons": seasons, "teams": {}}
    for team in teams:
        actions: dict[int, Counter] = defaultdict(Counter)
        confidence: list[float] = []
        frustrated = 0
        titles = 0
        for season, kind, ids, payload in db.execute(
            "SELECT season, kind, team_ids, payload_json FROM events ORDER BY seq"
        ):
            if team not in json.loads(ids):
                continue
            if kind in USER_KINDS:
                actions[season][kind] += 1
            elif kind == "owner.confidenceMoved":
                confidence.append(json.loads(payload)["confidence"])
            elif kind == "owner.frustrated":
                frustrated += 1
            elif kind == "champion.crowned":
                titles += 1
        report["teams"][team] = {
            "actions_per_season": {s: sum(actions[s].values()) for s in seasons},
            "action_kinds": dict(sum(actions.values(), Counter()).most_common()),
            "idle_seasons": [s for s in seasons if not actions[s]],
            "owner_confidence": ({"start": confidence[0], "end": confidence[-1],
                                  "low": min(confidence)} if confidence else None),
            "owner_frustrated": frustrated,
            "titles": titles,
        }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("save", help="path to a save file")
    args = parser.parse_args()
    with closing(sqlite3.connect(f"file:{args.save}?mode=ro", uri=True)) as db:
        report = analyze(db)
    json.dump(report, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
