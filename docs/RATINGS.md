# Player ratings (hockey) — DRAFT

Status: **v1 keys in code, final M1 signoff pending.** Community files supply these
hidden inputs. The game is intended to generate [advanced stats](ADVANCED_STATS.md)
that help evaluate and tune them, but does not yet produce full player stat lines.
The NHL-only M1 study supports parts of this design but does not empirically identify
every key. If keys change, update this file,
`packages/shared/src/sports/hockey.ts` and the roster schema together, bump
`ROSTER_FORMAT_VERSION`, and add a migration.

The [four-season MoneyPuck prototype](M1_PROTOTYPE_REPORT.md) provides preliminary
shot, team, skater and goalie evidence. It does not cover junior/European seasons,
drafts or contracts, so the rating list is still awaiting joint review.

## M1 evidence review and proposal

The season-held-out study supports keeping `shooting` and `passing` distinct: shot
geometry predicts goals, while xG, finishing and assists together predict later
skater goals better than one stat alone. `skating`, `puckHandling`, `defense`,
`physical` and `hockeyIq` remain gameplay concepts; this source does not identify
their separate effects. Hits repeat strongly between seasons, but that does not
establish the value of a `physical` rating. On/off xG is confounded by teammates,
competition and usage, so it does not isolate `defense` or `hockeyIq`.

For goalies, goals saved above xG is weakly repeatable and failed to improve one of
the two held-out forecasts. The source cannot separate `reflexes`, `positioning` and
`reboundControl`; it does not justify estimating `consistency` from one season's
save percentage. Those keys can remain in the game model provisionally, but should
not be presented as empirically measured talents.

**Proposed v1 decision:** retain the current keys and roster format. Do not
add `faceoffs` solely because faceoff percentage repeats, or split shooting without
a direct shot-power measure. Keep handedness as a possible fixed attribute. Revisit
the unmeasured keys when a suitable licensed event or tracking source is available.

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

## Later calibration questions

- Split `shooting` into shot accuracy vs. shot power? Depends on whether xG data separates them.
- Faceoffs (centers): own key, or part of `hockeyIq`?
- Do we need `discipline` (penalties taken) and `durability` (injury risk)?
- Handedness (L/R) as a fixed attribute, not a rating, for line fit and power-play units.
