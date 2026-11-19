"""Aging study: how a skater's scoring rate changes a year, by age (the delta method).

Each pair is one skater's two seasons in a row, both of MIN_TOI+ minutes: his points/60 over the
league's that season (so a change in league scoring does not read as aging), the change weighted
by the harmonic mean of the two seasons' minutes, by his age in the later season (season - birth
year, as the sim counts it). A band's number is its weighted change over its weighted level, in %.
Comparing a player with himself is the player fixed effect; the survivor bias (players who fall
out of the league leave no pair) is the same in the sim, since the balance lab's "Skater
points/60 a year" checks measure the sim the same way.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path

from ml.src.study import read_rows

MIN_TOI = 300
BANDS = ((18, 24), (25, 29), (30, 34))


def _birth_years(path: Path) -> dict[str, int]:
    """MoneyPuck's player lookup (`playerId`, `birthDate` as YYYY-MM-DD)."""
    return {r["playerId"]: int(r["birthDate"][:4]) for r in read_rows(path) if r["birthDate"]}


def study(processed: Path, births: Path) -> dict:
    born = _birth_years(births)
    seasons: dict[tuple[str, int], list[float]] = defaultdict(lambda: [0.0, 0.0])
    for r in read_rows(processed / "player_seasons.csv"):
        if r["league"] == "nhl" and r["position"] != "G":  # traded players have a row per team
            tally = seasons[(r["player_id"], int(r["season"]))]
            tally[0] += int(r["goals"]) + int(r["assists"])
            tally[1] += float(r["toi_minutes"])
    league: dict[int, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for (_, season), (points, toi) in seasons.items():
        if toi >= MIN_TOI:
            league[season][0] += points
            league[season][1] += toi
    # Per band and player: [weighted change, weighted level] of each of his pairs.
    pairs: dict[tuple, dict[str, list[tuple[float, float]]]] = {b: defaultdict(list) for b in BANDS}
    for (player, season), (points, toi) in seasons.items():
        later = seasons.get((player, season + 1))
        if not later or player not in born or min(toi, later[1]) < MIN_TOI:
            continue
        age = season + 1 - born[player]
        band = next((b for b in BANDS if b[0] <= age <= b[1]), None)
        if band is None:
            continue
        was = points / toi / (league[season][0] / league[season][1])
        now = later[0] / later[1] / (league[season + 1][0] / league[season + 1][1])
        weight = 2 / (1 / toi + 1 / later[1])
        pairs[band][player].append((weight * (now - was), weight * (now + was) / 2))

    def band_report(by_player: dict[str, list[tuple[float, float]]]) -> dict:
        n = sum(len(v) for v in by_player.values())
        if n < 30:
            raise ValueError("At least 30 skater pairs per age band are required")
        change = sum(c for v in by_player.values() for c, _ in v)
        level = sum(lv for v in by_player.values() for _, lv in v)
        ratio = change / level
        # Standard error of a ratio, clustered by player (his pairs are not independent).
        se = math.sqrt(sum(sum(c - ratio * lv for c, lv in v) ** 2
                           for v in by_player.values())) / level
        return {"pairs": n, "players": len(by_player),
                "pct_per_year": round(100 * ratio, 2), "se": round(100 * se, 2),
                "ci95": [round(100 * (ratio - 1.96 * se), 2),
                         round(100 * (ratio + 1.96 * se), 2)]}

    return {
        "design": __doc__.strip().splitlines()[0],
        "min_toi": MIN_TOI,
        "seasons": sorted(league),
        "bands": {f"{lo}-{hi}": band_report(pairs[(lo, hi)]) for lo, hi in BANDS},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--processed", type=Path, default=Path("ml/data/processed"))
    parser.add_argument("--births", type=Path,
                        default=Path("ml/data/raw/moneypuck/allPlayersLookup.csv"))
    args = parser.parse_args()
    report = study(args.processed, args.births)
    (args.processed / "aging_study.json").write_text(json.dumps(report, indent=2) + "\n",
                                                     encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
