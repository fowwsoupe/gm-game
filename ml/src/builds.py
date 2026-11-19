"""Skater shapes and play-trait evidence (player traits brief, job 1).

Shapes: per-60 profile of each NHL skater season with 600+ minutes, one stat per rating key
(docs/RATINGS.md): xG (shooting), primary assists (passing), hits (physical), takeaways
(hockeyIq) and on-ice xG against, sign flipped (defense, with takeaways). Each stat is z-scored
within forwards and within defence, each player's own mean is subtracted (his shape, not how
good he is), then k-means with k picked by silhouette. Faceoffs are left out: forwards' draws
are taken almost only by centres, so the stat would split forwards by position, which the game
already assigns. Output per cluster: its share and its centre per rating key, in SDs.

Traits: year-to-year r (same player, consecutive seasons, within forwards and within defence)
of mean shot distance (50+ unblocked attempts) and penalties taken per 60 (600+ minutes), and
of the part of penalties per 60 that hits per 60 do not explain (the sim already ties penalties
to `physical`). A trait is kept only at r >= 0.4 in both groups.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
from collections import defaultdict
from pathlib import Path

from ml.src.study import _rows

MIN_SECONDS = 600 * 60
MIN_SHOTS = 50
KEEP_R = 0.4
GROUPS = {"forwards": ("C", "L", "R"), "defence": ("D",)}
K_RANGE = {"forwards": range(3, 7), "defence": range(2, 5)}
# MoneyPuck column per profile stat; the sign makes "higher" mean "better at that key".
STATS = {"xg": ("I_F_xGoals", 1), "primary_assists": ("I_F_primaryAssists", 1),
         "hits": ("I_F_hits", 1), "takeaways": ("I_F_takeaways", 1),
         "xg_against": ("OnIce_A_xGoals", -1)}
KEYS = {"shooting": ("xg",), "passing": ("primary_assists",), "physical": ("hits",),
        "hockeyIq": ("takeaways",), "defense": ("takeaways", "xg_against")}


def skater_seasons(raw: Path) -> list[dict]:
    """All-situations skater seasons from MoneyPuck's skaters_<season>.csv files."""
    rows = []
    for path in sorted(raw.glob("skaters_*.csv")):
        with path.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                if row["situation"] != "all":
                    continue
                seconds = float(row["icetime"])
                group = next((g for g, pos in GROUPS.items() if row["position"] in pos), None)
                if group is None or seconds <= 0:
                    continue
                per60 = {s: sign * float(row[col]) * 3600 / seconds
                         for s, (col, sign) in STATS.items()}
                rows.append({"player_id": row["playerId"], "season": int(row["season"]),
                             "group": group, "seconds": seconds, "per60": per60,
                             "penalties_per60": float(row["penalties"]) * 3600 / seconds})
    return rows


def shapes(rows: list[dict]) -> list[list[float]]:
    """Z-score each stat across the rows, then subtract each row's own mean."""
    out = [[r["per60"][s] for s in STATS] for r in rows]
    for j in range(len(STATS)):
        col = [v[j] for v in out]
        mean = sum(col) / len(col)
        sd = math.sqrt(sum((x - mean) ** 2 for x in col) / (len(col) - 1)) or 1.0
        for v in out:
            v[j] = (v[j] - mean) / sd
    return [[x - sum(v) / len(v) for x in v] for v in out]


def _d2(a: list[float], b: list[float]) -> float:
    return sum((x - y) ** 2 for x, y in zip(a, b))


def kmeans(points: list[list[float]], k: int, seed: int = 1,
           restarts: int = 10) -> tuple[list[list[float]], list[int]]:
    """Lloyd's k-means with k-means++ starts; the lowest-inertia restart wins."""
    rng = random.Random(seed)
    best = None
    for _ in range(restarts):
        centres = [rng.choice(points)]
        while len(centres) < k:
            weights = [min(_d2(p, c) for c in centres) for p in points]
            centres.append(rng.choices(points, weights)[0])
        labels: list[int] = []
        for _ in range(100):
            new_labels = [min(range(k), key=lambda c: _d2(p, centres[c])) for p in points]
            if new_labels == labels:
                break
            labels = new_labels
            for c in range(k):
                members = [p for p, label in zip(points, labels) if label == c]
                if members:
                    centres[c] = [sum(col) / len(members) for col in zip(*members)]
        inertia = sum(_d2(p, centres[label]) for p, label in zip(points, labels))
        if best is None or inertia < best[0]:
            best = (inertia, [list(c) for c in centres], labels)
    return best[1], best[2]


def silhouette(points: list[list[float]], labels: list[int]) -> float:
    """Mean silhouette: (b - a) / max(a, b), a = own cluster, b = nearest other cluster."""
    k = max(labels) + 1
    sizes = [labels.count(c) for c in range(k)]
    total = 0.0
    for i, p in enumerate(points):
        sums = [0.0] * k
        for q, label in zip(points, labels):
            sums[label] += math.sqrt(_d2(p, q))
        own = labels[i]
        if sizes[own] == 1:
            continue
        a = sums[own] / (sizes[own] - 1)
        b = min(sums[c] / sizes[c] for c in range(k) if c != own and sizes[c])
        total += (b - a) / max(a, b)
    return total / len(points)


def cluster(points: list[list[float]], ks: range, seed: int = 1) -> dict:
    """Silhouette for each k, then the best k's clusters: share and centre per stat."""
    fits = {k: kmeans(points, k, seed) for k in ks}
    scores = {k: silhouette(points, labels) for k, (_, labels) in fits.items()}
    k = max(scores, key=scores.get)
    centres, labels = fits[k]
    clusters = sorted(
        ({"share": labels.count(c) / len(labels),
          "stats": dict(zip(STATS, centres[c]))} for c in range(k)),
        key=lambda c: -c["share"])
    return {"k": k, "silhouette": {str(n): round(s, 3) for n, s in scores.items()},
            "clusters": clusters}


def pearson(pairs: list[tuple[float, float]]) -> float:
    n = len(pairs)
    mx = sum(a for a, _ in pairs) / n
    my = sum(b for _, b in pairs) / n
    sxy = sum((a - mx) * (b - my) for a, b in pairs)
    sxx = sum((a - mx) ** 2 for a, _ in pairs)
    syy = sum((b - my) ** 2 for _, b in pairs)
    return sxy / math.sqrt(sxx * syy)


def _slope(pairs: list[tuple[float, float]]) -> float:
    mx = sum(a for a, _ in pairs) / len(pairs)
    my = sum(b for _, b in pairs) / len(pairs)
    return (sum((a - mx) * (b - my) for a, b in pairs) /
            sum((a - mx) ** 2 for a, _ in pairs))


def year_to_year(values: dict[tuple[str, int], float]) -> dict:
    """r between a player's value in one season and the next."""
    pairs = [(v, values[(pid, season + 1)]) for (pid, season), v in values.items()
             if (pid, season + 1) in values]
    return {"pairs": len(pairs), "r": round(pearson(pairs), 3)}


def shot_distances(processed: Path) -> dict[tuple[str, int], tuple[float, int]]:
    """Mean distance from the net (x=89, y=0) of each shooter season's unblocked attempts."""
    tally: dict[tuple[str, int], list[float]] = defaultdict(lambda: [0.0, 0])
    for row in _rows(processed / "shots.csv"):
        shooter = row["shooter_id"].removesuffix(".0")
        if not shooter.isdigit():  # unknown shooters have placeholder ids
            continue
        t = tally[(shooter, int(row["season"]))]
        t[0] += math.hypot(89 - float(row["x"]), float(row["y"]))
        t[1] += 1
    return {key: (total / n, n) for key, (total, n) in tally.items()}


def study(raw: Path, processed: Path) -> dict:
    rows = [r for r in skater_seasons(raw) if r["seconds"] >= MIN_SECONDS]
    distances = shot_distances(processed)
    report: dict = {"design": __doc__.strip().splitlines()[0], "groups": {}, "traits": {}}
    trait_r: dict[str, list[float]] = defaultdict(list)
    for group in GROUPS:
        members = [r for r in rows if r["group"] == group]
        if len(members) < 100:
            raise ValueError(f"At least 100 {group} seasons with 600+ minutes are required")
        found = cluster(shapes(members), K_RANGE[group])
        for c in found["clusters"]:
            c["keys"] = {key: round(sum(c["stats"][s] for s in stats) / len(stats), 2)
                         for key, stats in KEYS.items()}
            c["stats"] = {s: round(v, 2) for s, v in c["stats"].items()}
            c["share"] = round(c["share"], 3)
        found["skater_seasons"] = len(members)
        report["groups"][group] = found

        ids = {(r["player_id"], r["season"]) for r in members}
        distance = {key: d for key, (d, n) in distances.items() if key in ids and n >= MIN_SHOTS}
        penalties = {(r["player_id"], r["season"]): r["penalties_per60"] for r in members}
        # The sim already ties penalties to `physical`; this part is what hits do not explain.
        hits = {(r["player_id"], r["season"]): r["per60"]["hits"] for r in members}
        slope = _slope([(hits[key], p) for key, p in penalties.items()])
        beyond_hits = {key: p - slope * hits[key] for key, p in penalties.items()}
        for trait, values in (("shot_distance", distance), ("penalties_per60", penalties),
                              ("penalties_beyond_hits", beyond_hits)):
            report["traits"].setdefault(trait, {})[group] = year_to_year(values)
            trait_r[trait].append(report["traits"][trait][group]["r"])
    for trait, rs in trait_r.items():
        report["traits"][trait]["keep"] = min(rs) >= KEEP_R
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, default=Path("ml/data/raw/moneypuck"))
    parser.add_argument("--processed", type=Path, default=Path("ml/data/processed"))
    args = parser.parse_args()
    report = study(args.raw, args.processed)
    (args.processed / "builds_study.json").write_text(json.dumps(report, indent=2) + "\n",
                                                      encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
