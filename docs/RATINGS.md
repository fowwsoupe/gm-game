# Player ratings (hockey)

Status: **final for v0.1** (roster format v2). The list is code in
`packages/shared/src/sports/hockey.ts` (`SKATER_RATINGS`, `GOALIE_RATINGS`). The roster
schema, player generation and roster export are all built from those two lists, so this file
explains them and the code defines them.

Rules (from the feature spec):

- Ratings are **hidden**, 1–99, flat numbers so ML models can read them directly.
- The UI never shows an overall; it shows percentiles, stats and scouting text.
- `potential` is the hidden ceiling a player can develop toward.

Changing the list means: edit the constant, bump `ROSTER_FORMAT_VERSION`, upgrade older files in
`upgradeRosterFile` (`packages/shared/src/roster-schema.ts`), add a save migration in
`packages/data/src/migrations.ts`, regenerate `rosters/fictional-template.json`
(`pnpm roster:template`) and update this file.

## Skaters (C, LW, RW, D)

| Key            | Meaning                                    | In the sim today                                        |
| -------------- | ------------------------------------------ | ------------------------------------------------------- |
| `skating`      | Speed and agility                          | 10% of a skater's attack                                |
| `shooting`     | Getting shots off from good ice, finishing | 40% of attack; who shoots and how dangerous the shot is |
| `passing`      | Setting up chances                         | 30% of attack; who gets the assists                     |
| `puckHandling` | Holding the puck, controlled entries/exits | 20% of attack                                           |
| `defense`      | Suppressing shots and chances against      | 50% of a skater's defence; picks the penalty killers    |
| `physical`     | Battles, hits, net-front play              | 20% of defence; who takes penalties                     |
| `hockeyIq`     | Decision quality                           | 30% of defence                                          |
| `faceoffs`     | Winning draws (matters for centres)        | The centres' draw skill nudges both attack and defence  |

## Goalies (G)

| Key              | Meaning                              | In the sim today                   |
| ---------------- | ------------------------------------ | ---------------------------------- |
| `reflexes`       | Saves on high-danger shots           | 40% of the goaltending score       |
| `positioning`    | Saves on low and medium-danger shots | 35%                                |
| `reboundControl` | Second chances allowed               | 15%                                |
| `consistency`    | Game-to-game steadiness              | 10% (no game-to-game variance yet) |

## Evidence (M1 study)

From `ml/data/processed/rating_evidence.json` and `predictive_study.json` (MoneyPuck data,
453,000 shots; player pairs are the same player in consecutive seasons, minimum 600 skater or
1,000 goalie minutes). Correlations, not causes. "Repeats" is year-to-year r; "predicts goals"
is r with next season's goals per 60.

| Stat                      | Repeats | Predicts goals | Decision                                                    |
| ------------------------- | ------- | -------------- | ----------------------------------------------------------- |
| xG per 60 (chance volume) | 0.93    | 0.82           | The biggest skater signal: `shooting`, `skating`, `passing` |
| Primary assists per 60    | 0.72    | 0.60           | Keep `passing` as its own key                               |
| On/off-ice xG% gap        | 0.80    | 0.61           | Two-way impact: `defense` and `hockeyIq`                    |
| Takeaways per 60          | 0.58    | 0.33           | Supports `defense` and `hockeyIq`                           |
| Finishing over xG per 60  | 0.32    | 0.13           | Finishing is real but small: one `shooting` key, not two    |
| Faceoff %                 | 0.75    | —              | A distinct, repeatable skill: its own `faceoffs` key        |
| Hits per 60               | 0.91    | −0.14          | A real style, not a scoring skill: `physical` stays small   |
| Goalie GSAx per 60        | 0.11    | —              | Goalie skill barely repeats: keep goalie effects small      |

Team level: next season's win % follows shot differential (r 0.49), xG differential (0.52) and
goal differential (0.58) more than save % (0.28) or shooting % (0.31).

## Decided questions

- **Split `shooting` into accuracy and power?** No. The shot data cannot separate them (shot
  type is the only hint), and finishing above expected repeats weakly (r 0.32).
- **Faceoffs: own key or part of `hockeyIq`?** Own key. Faceoff % repeats at r 0.75 and has
  little to do with the other skills. Its effect on winning is small, and so is its weight in the
  sim. Saves and v1 roster files start each skater's `faceoffs` at the average of his other
  ratings, so nobody's overall moves.
- **`discipline` and `durability`?** Not for v0.1. The study has no penalty or injury data to
  base them on; `physical` drives penalties and injuries use a flat rate. Revisit with data.
- **Handedness?** A fixed player attribute (not a 1–99 rating) when line fit and power-play
  units need it. Not part of this list.
