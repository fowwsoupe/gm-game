# Player ratings (hockey) — DRAFT

Status: **draft, v1 keys in code.** Finalize after Azmi's M1 analysis of which stats drive
goals and wins; then update this file, `packages/shared/src/sports/hockey.ts` and the roster
schema together, bump `ROSTER_FORMAT_VERSION`, and add a migration.

Rules (from the feature spec):

- Ratings are **hidden**, 1–99, flat numbers so ML models can read them directly.
- The UI never shows an overall; it shows percentiles, stats and scouting text.
- `potential` is the hidden ceiling a player can develop toward.

## Skaters (C, LW, RW, D)

| Key            | What it drives in the sim                                        |
| -------------- | ---------------------------------------------------------------- |
| `skating`      | Speed and agility: zone entries, backchecking, drawing penalties |
| `shooting`     | Shot quality and finishing (shooting % over expected)            |
| `passing`      | Setting up high-danger chances, power-play play-making           |
| `puckHandling` | Holding possession, controlled entries and exits                 |
| `defense`      | Suppressing shots and chances against, positioning               |
| `physical`     | Battles, hits, net-front play; wear over a season                |
| `hockeyIq`     | Decision quality; lifts all of the above in the sim              |

## Goalies (G)

| Key              | What it drives in the sim                                                                |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `reflexes`       | Saves on high-danger and rebound shots                                                   |
| `positioning`    | Saves on low and medium-danger shots                                                     |
| `reboundControl` | How many second chances the other team gets                                              |
| `consistency`    | Game-to-game variance (research: goalie SV% year to year is mostly noise, r ≈ 0.12–0.30) |

## Open questions for M1

- Split `shooting` into shot accuracy vs. shot power? Depends on whether xG data separates them.
- Faceoffs (centers): own key, or part of `hockeyIq`?
- Do we need `discipline` (penalties taken) and `durability` (injury risk)?
- Handedness (L/R) as a fixed attribute, not a rating, for line fit and power-play units.
