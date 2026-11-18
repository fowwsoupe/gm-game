# Player ratings (hockey)

Status: **v0.1 list in code (roster format v2).** The list is code in
`packages/shared/src/sports/hockey.ts` (`SKATER_RATINGS`, `GOALIE_RATINGS`). The roster
schema, player generation and roster export are all built from those two lists, so this file
explains them and the code defines them. M1 is signed off on the NHL-only prototype (scope
decision in [PLAN.md](PLAN.md); junior/European, draft and contract data come later).

Rules (from the feature spec):

- Ratings are **hidden**, 1–99, flat numbers so ML models can read them directly.
- The UI never shows an overall; it shows percentiles, stats and scouting text.
- `potential` is the hidden ceiling a player can develop toward.

Changing the list means: edit the constant, bump `ROSTER_FORMAT_VERSION`, upgrade older files in
`upgradeRosterFile` (`packages/shared/src/roster-schema.ts`), add a save migration in
`packages/data/src/migrations.ts`, regenerate `rosters/fictional-template.json`
(`pnpm roster:template`) and update this file.

## Skaters (C, LW, RW, D)

| Key            | Meaning                                    | In the sim today                                                           |
| -------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `skating`      | Speed and agility                          | 10% of a skater's attack                                                   |
| `shooting`     | Getting shots off from good ice, finishing | 40% of attack; who shoots and how dangerous the shot is                    |
| `passing`      | Setting up chances                         | 30% of attack; who gets the assists                                        |
| `puckHandling` | Holding the puck, controlled entries/exits | 20% of attack                                                              |
| `defense`      | Suppressing shots and chances against      | 50% of a skater's defence; picks the penalty killers                       |
| `physical`     | Battles, hits, net-front play              | 20% of defence; who takes penalties                                        |
| `hockeyIq`     | Decision quality                           | 30% of defence                                                             |
| `faceoffs`     | Winning draws (matters for centres)        | The centres' draw skill nudges both attack and defence (calibrated, below) |

## Goalies (G)

| Key              | Meaning                              | In the sim today                    |
| ---------------- | ------------------------------------ | ----------------------------------- |
| `reflexes`       | Saves on high-danger shots           | 40% of the goaltending score        |
| `positioning`    | Saves on low and medium-danger shots | 35%                                 |
| `reboundControl` | Second chances allowed               | 15%                                 |
| `consistency`    | Game-to-game steadiness              | 10%; also narrows his per-game form |

## Evidence (M1 study)

From the NHL-only [M1 prototype study](research/2026-11-m1-moneypuck-study.md) (four MoneyPuck seasons,
453,000 shots; player pairs are the same player in consecutive seasons, minimum 600 skater or
1,000 goalie minutes). Regenerate the numbers locally with the commands in
[`ml/README.md`](../ml/README.md); they land in `ml/data/processed/rating_evidence.json` and
`predictive_study.json`, which are not committed (source data is non-commercial).
Correlations, not causes. "Repeats" is year-to-year r; "predicts goals" is r with next
season's goals per 60.

| Stat                      | Repeats | Predicts goals | Decision                                                    |
| ------------------------- | ------- | -------------- | ----------------------------------------------------------- |
| xG per 60 (chance volume) | 0.93    | 0.82           | The biggest skater signal: `shooting`, `skating`, `passing` |
| Primary assists per 60    | 0.72    | 0.60           | Keep `passing` as its own key                               |
| On/off-ice xG% gap        | 0.80    | 0.61           | Carries team and usage effects; does not isolate a key      |
| Takeaways per 60          | 0.58    | 0.33           | Weak support for `defense` / `hockeyIq`, not a measurement  |
| Finishing over xG per 60  | 0.32    | 0.13           | Finishing is real but small: one `shooting` key, not two    |
| Faceoff %                 | 0.75    | —              | Repeatable, small win effect (below): `faceoffs` key        |
| Hits per 60               | 0.91    | −0.14          | A real style, not a scoring skill: `physical` stays small   |
| Goalie GSAx per 60        | 0.11    | —              | Barely repeats, includes team effects: keep goalies small   |

Team level: next season's win % correlates with goal differential (r 0.58), xG differential
(0.52) and shot differential (0.49) more than with save % (0.28) or shooting % (0.31), but the
ranking of these predictors reversed between the two held-out seasons, so none is a robust winner.

What the study does not measure: `skating`, `puckHandling`, `defense`, `physical` and
`hockeyIq` stay gameplay concepts; this NHL-only source cannot separate their effects. The
goalie keys cannot be told apart either, and one season's save % is not a `consistency`
estimate. Treat these as design choices, not measured talents.

## Decided questions

- **Split `shooting` into accuracy and power?** No. The shot data cannot separate them (shot
  type is the only hint), and finishing above expected repeats weakly (r 0.32).
- **Faceoffs: own key or part of `hockeyIq`?** Own key, **kept**. Faceoff % repeats at r 0.75.
  The effect on winning (`ml/src/faceoffs.py`, 128 team seasons): one SD of team faceoff % (2.6
  points) goes with +0.23 goals/game raw, which mostly reflects better teams having better
  centres, and +0.067 goals/game (95% CI -0.04 to 0.17) after the prior season's goal diff. The
  sim's `FACEOFF_WEIGHT` was 0.05, worth about +0.01 per SD, so faceoffs did almost nothing. It is
  now 0.2, about +0.05 per SD, and the balance lab checks it stays within 0.02-0.17. Saves and v1
  roster files start each skater's `faceoffs` at the average of his other ratings, so nobody's
  overall moves.
- **`discipline` and `durability`?** Not for v0.1. The study has no penalty or injury data to
  base them on; `physical` drives penalties and injuries use a flat rate. Revisit with data.
- **Handedness?** A fixed player attribute (not a 1–99 rating) when line fit and power-play
  units need it. Not part of this list.
