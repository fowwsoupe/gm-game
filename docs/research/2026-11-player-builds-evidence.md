# Player builds and traits: real-data evidence (2026-11)

Job 1 of the [player traits brief](2026-11-player-traits.md). `ml/src/builds.py` on the M1
MoneyPuck data (regular seasons 2022-23 to 2025-26, all situations, skater seasons with 600+
minutes): 1,484 forward and 823 defence seasons. Reproduce with
`python3 -m ml.src.builds` (writes `ml/data/processed/builds_study.json`). Raw data stays out
of the repo (non-commercial terms); only the aggregate table below ships, in
`packages/sim/src/sports/hockey/tuning.ts` (`SKATER_BUILD_CLUSTERS`).

## Method

Per-60 stat per rating key, as in `docs/RATINGS.md`: xG (shooting), primary assists (passing),
hits (physical), takeaways (hockeyIq; and half of defense), on-ice xG against with its sign
flipped (the other half of defense). Each stat is z-scored within forwards and within defence,
each player's own mean is subtracted (his shape, not his level), then k-means (k-means++, 10
restarts) with k picked by mean silhouette. Centres are in SDs; `skating`, `puckHandling` and
`faceoffs` have no stat here and stay 0. Faceoff % is left out of the forward clustering: only
centres take draws, so it would split forwards by position, which the game already assigns.

## Clusters

Silhouette by k (higher is better):

| Group    | k=2   | k=3   | k=4   | k=5       | k=6   |
| -------- | ----- | ----- | ----- | --------- | ----- |
| Forwards |       | 0.217 | 0.222 | **0.225** | 0.224 |
| Defence  | 0.246 | 0.217 | 0.223 |           |       |

The silhouettes are low and flat: real shapes are a continuum, and the clusters are a coarse but
honest split of it, not natural types. That is enough for the brief's goal (players are born
with a shape, not as generalists with noise).

Centres per rating key (SDs) and share of skater seasons. Build keys are picked from each
centre's biggest offsets; `defensiveF` is new and needs `build.*` strings in job 2.

| Group    | Build        | Share | shooting | passing | physical | hockeyIq | defense |
| -------- | ------------ | ----- | -------- | ------- | -------- | -------- | ------- |
| Forwards | `defensiveF` | 27.5% | -0.23    | -0.31   | -0.17    | -0.19    | 0.35    |
| Forwards | `twoWay`     | 21.2% | -0.19    | -0.06   | -0.23    | 1.16     | 0.24    |
| Forwards | `sniper`     | 18.8% | 1.13     | 0.04    | -0.33    | -0.52    | -0.42   |
| Forwards | `playmaker`  | 16.4% | 0.04     | 1.31    | -0.83    | -0.20    | -0.26   |
| Forwards | `grinder`    | 16.0% | -0.72    | -0.79   | 1.83     | -0.38    | -0.16   |
| Defence  | `shutdownD`  | 56.9% | -0.34    | -0.37   | 0.65     | -0.19    | 0.03    |
| Defence  | `offensiveD` | 43.1% | 0.45     | 0.49    | -0.86    | 0.25     | -0.04   |

Against today's rule builds: `powerForward` (physical and shooting together) and `twoWayD` have
no cluster; job 2 drops them from generation and classification (old saves can keep showing the
key, the strings stay). The `defensiveF` centre is mostly on-ice xG against, which also carries
team and usage effects (`docs/RATINGS.md`); it is kept because it is the biggest cluster.

## Traits

Year-to-year r, same player, consecutive seasons:

| Trait check                         | Forwards (pairs) | Defence (pairs) | Keep |
| ----------------------------------- | ---------------- | --------------- | ---- |
| Mean shot distance (50+ attempts)   | 0.752 (926)      | 0.676 (497)     | yes  |
| Penalties taken per 60              | 0.747 (926)      | 0.740 (509)     | yes  |
| Penalties per 60 beyond hits per 60 | 0.648 (926)      | 0.606 (509)     | yes  |

Both traits clear the brief's 0.4 bar in both groups, so job 3 builds both (net-front /
perimeter, disciplined / undisciplined). The third row checks that penalty-taking repeats beyond
what `physical` (hits) already drives in the sim, so the discipline lever is not double
counting it.
