# Model contracts (for the ML track)

Each model below replaces a rules-based default behind a small interface in `packages/sim`.
The sim stays pure TypeScript: no ONNX runtime, no files. A model ships as **data the sim can
load** (a JSON table, or coefficients), or as a TypeScript implementation of the interface.

How to check a model: run `pnpm lab` (default), then the same with the candidate, same seed,
and paste both reports in the PR. A model is acceptable when every lab check stays in range
and it beats the default on its own held-out metric (AUC, log loss, error).

## 1. Shot quality (xG): `GoalModel.shotXg` (hockey)

`shotXg({ x, y, shooting, power }) -> probability a shot is a goal against an average goalie`.
`x`: feet from the goal line toward the dots; `y`: feet from the middle of the ice (net at 0, 0);
`shooting`: shooter's rating (1-99); `power`: his team has a penalty advantage. The engine
multiplies in the goalie (`goalieSensitivity`) and chooses who shoots and where from.

**File format** (`gm-xg-table`, parsed by `parseXgTable`, template in
`ml/models/xg-rules-template.json`, made by `pnpm xg:template`):

```json
{ "format": "gm-xg-table", "version": 1, "source": "model, data, date",
  "cellFeet": 5, "goal": [[...]], "shooting": { "reference": 65, "exponent": 0.7 }, "powerPlay": 1.5 }
```

`goal[i][j]` = chance of a goal from the cell `i` cells out from the goal line and `j` out from
the middle (|y|), for a shooter rated `reference`, even strength. Shots beyond the table use the
last row and column. Export a trained model by evaluating it on the cell centres. Test it:

```
pnpm lab --xg ml/models/xg.json
```

Targets: league save % .890-.900, goals per team per game 3.0-3.15 (lab ranges), AUC 0.77-0.81
on held-out seasons (research report). The lab will show which of these a new table moves; if it
shifts the overall scoring level, rescale it (or `HOCKEY_TUNING.xgScale`) rather than the checks.

In the app, drop the file at `<userData>/models/xg.json`; an invalid file is ignored and the
default model is used.

## 2. Contract demand: `ContractDemandModel.ask(rules, player) -> dollars per year`

What a player asks to sign (re-signing and free agency). Placed in `Models.contractDemand`
(default `rulesContractDemand`, which is `marketSalary`). Should work in percent of cap through
`rules.cap`, never hard-code dollars. Term limits, minimum and maximum are enforced after it by
the CBA engine, so a model cannot create an illegal contract. Check: the lab's payroll / cap and
teams-over-the-cap lines.

## 3. Player value: `PlayerValuator.value(player, team) -> Valuation` (M6)

Surplus value per team (can be negative). Placeholder: `naiveValuator`.

## 4. Development: `DevelopmentModel` (M4)

Yearly rating and potential changes with age. Default: `rulesDevelopment(HOCKEY_DEVELOPMENT)`.
Check: lab "league avg rating drift" and career-shape tests.

## 5. Stats to ratings: `ratingsFromStats(table, position, totals, seasonGames)` (hockey)

Estimates a player's hidden ratings from one season's totals (`hockeySeasonStats`), each with an
uncertainty `sd` in rating points, so a community roster can be rated from stats. The default
table (`STATS_TO_RATINGS`) is fitted on the sim itself by `pnpm ratings:fit`: it plays many
seasons and fits each rating on the stat lines the sim produced (one league in five held out
for R² and error). Rerun it after any change to the game sim or player generation.

Features: skaters TOI/game and goals, assists, shots and +/- per 60; goalies save % and share
of games. A sample under `FULL_SAMPLE` (half a season for skaters, a quarter for goalies) is
pulled toward the position average and its `sd` widens toward the position spread.

What a stat line shows today (held-out R², 40 leagues): `shooting` about 0.78, `passing` 0.55-0.61,
other skater keys 0.43-0.49, goalie keys 0.25-0.36 (one season's save % is mostly noise, as in
the NHL). Those keys mostly ride a player's overall level, since generation
draws a player's ratings together, so their estimates are close to "how good is he" with a
wide `sd`. A trained replacement must emit the same table format (format `gm-stats-to-ratings`)
and beat these R² values on held-out leagues.
