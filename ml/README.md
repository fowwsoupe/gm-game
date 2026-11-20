# ml/

Python trains **two models** where a fit is needed, stats to ratings and development, and
runs calibration studies that set the balance lab's targets and the sim's tuning numbers.
Everything else is calibrated rules ([ADR 0005](../docs/adr/0005-calibrate-first.md)). The shipped game never runs Python.

```
ml/
  data/raw/         # downloaded historical data (git-ignored)
  data/processed/   # cleaned features (git-ignored)
  src/              # pipeline, model training, calibration studies
  models/           # exported model tables (JSON) the game loads (committed, keep them small)
```

## M1 data contract

The M1 pipeline reads **local CSVs only**. Check a source's current terms and record
the rights status before staging it in `data/raw/`. Do not commit raw or processed
real-player data. The pipeline never downloads from a website. The current MoneyPuck
internal prototype has not been cleared for commercial models. Source review is in
[`docs/M1_DATA_ACCESS.md`](../docs/M1_DATA_ACCESS.md).

Put these seven files in `ml/data/raw/` (UTF-8, header row; IDs are stable opaque strings):

| File | Required columns | Grain |
| --- | --- | --- |
| `source.json` | `source`, `rights_note` (nonempty strings) | Provenance and rights review for this batch |
| `games.csv` | `season,game_id,home_team_id,away_team_id,home_goals,away_goals,home_won` | One final game per row |
| `shots.csv` | `season,game_id,event_id,team_id,shooter_id,is_goal,x,y,shot_type,xg` | One unblocked attempt per row |
| `player_seasons.csv` | `season,player_id,league,team_id,position,games,goals,assists,shots,toi_minutes` | One player, league and team season per row |
| `player_features.csv` | `season,player_id,league,position,toi_minutes,goals,xg,primary_assists,hits,takeaways,giveaways,faceoffs_won,faceoffs_lost,on_ice_xg_pct,off_ice_xg_pct,goalie_xga,goalie_ga,goalie_shots_against` | One player season of analysis features |
| `drafts.csv` | `draft_year,player_id,round,overall,team_id` | One draft pick per row |
| `contracts.csv` | `season,player_id,team_id,cap_hit,expires_after_season` | One player and team contract season per row |

`season` is the opening calendar year (2025 for 2025–26). `league` is `nhl`, `junior`,
or `europe`. Position is `C`, `LW`, `RW`, `D`, or `G`. `is_goal` and `home_won` are
`0` or `1`; `home_won` identifies shootout winners when recorded goal totals tie.
`xg` is a 0–1 pre-shot goal probability.
Shot coordinates are normalized to feet with every team attacking toward x=89:
`x` is 0–100 and `y` is −42.5–42.5. `cap_hit` is an integer number of dollars.
Empty `drafts.csv` or `contracts.csv` can have only a header while building a source
adapter, but original M1 scope requires real draft and contract coverage unless the
team explicitly changes the milestone. Files from multiple approved
sources can be joined before staging; `source.json` should identify every source and
permission. The pipeline validates required fields, uniqueness, numeric bounds and
shot-to-game/team links. Extra source-specific columns are discarded.

From the repository root, with staged normalized files:

```bash
python3 -m ml.src.pipeline
python3 -m ml.src.analyze
python3 -m unittest discover -s ml/tests -v
```

The pipeline writes normalized CSVs, `team_seasons.csv`, and `summary.json` to
`ml/data/processed/`. Analysis writes `rating_evidence.json` there. It reports shot
goal rates by distance and type, plus correlations between team metrics and the same
team's **next-season** win percentage and consecutive player seasons. It suppresses
rates below 100 shots and correlations below 30 pairs. The season-held-out study
writes `predictive_study.json` and compares prediction errors with simple baselines.
These are observational checks, not causal player-rating estimates. `evidence_ready`
is only a minimum sample-size check; the team still needs to inspect source quality,
leakage, and coverage when using the study to tune a game model.

## MoneyPuck internal prototype

The [MoneyPuck download page](https://moneypuck.com/data.htm) links the season shot
ZIPs and skater/goalie season CSVs. The converter uses only these published files. For
the four completed seasons in the current prototype, place `shots_2022.zip` through
`shots_2025.zip`, `skaters_2022.csv` through `skaters_2025.csv`, `goalies_2022.csv`
through `goalies_2025.csv` and the player lookup `allPlayersLookup.csv` (birth dates, for
`aging`) in `ml/data/raw/moneypuck/`, then run:

```bash
python3 -m ml.src.moneypuck --seasons 2022 2023 2024 2025
python3 -m ml.src.pipeline --raw ml/data/raw/normalized --processed ml/data/processed
python3 -m ml.src.analyze --processed ml/data/processed
python3 -m ml.src.study --processed ml/data/processed
python3 -m ml.src.faceoffs --processed ml/data/processed
python3 -m ml.src.form --processed ml/data/processed
python3 -m ml.src.aging --processed ml/data/processed
python3 -m ml.src.builds --raw ml/data/raw/moneypuck --processed ml/data/processed
```

`builds` writes `builds_study.json`: skater shapes clustered by k-means (k by silhouette) and
the year-to-year r of shot distance and penalties per 60. Its centres and shares are the sim's
`SKATER_BUILD_CLUSTERS` ([evidence](../docs/research/2026-11-player-builds-evidence.md)).

`faceoffs` writes `faceoff_study.json`: goal diff/game per SD of team faceoff %, raw (an upper
bound) and after prior-season goal diff. It calibrates the sim's `FACEOFF_WEIGHT`; the balance
lab's "Faceoff effect" check measures the same number in the sim.

`form` writes `form_study.json`: how much a team game's goals vary around expected goals beyond
chance (variance ratio; 1.169 in 2022-25). That excess is the ceiling for per-game goalie form,
the sim's honest playoff momentum (`HOCKEY_TUNING.goalieFormSd`); the balance lab's "Goals vs
expected" check measures the same ratio in the sim.

`aging` writes `aging_study.json`: how a skater's points/60 (over the league's) changes a year
by age, from his own seasons in a row (the delta method: each player is his own baseline). In
2022-25 it is +3.6% a year to 24, -1.4% at 25-29 and -4.0% at 30-34. These are the development
model's targets; the balance lab's "Skater points/60 a year" checks measure the same in the sim.

The adapter filters playoffs, normalizes shot coordinates and positions, preserves
shootout winners, and records source inconsistencies. Its drafts and contracts files
are header-only because MoneyPuck does not supply them. It also cannot supply junior
or European player seasons. The [prototype results](../docs/M1_PROTOTYPE_REPORT.md)
include the season-held-out study. Raw and processed files remain git-ignored;
**commercial ML and shipped-model rights are still pending**.

## Calibration workflow

Measure something the game can reproduce: a league-level rate, an effect size or a
distribution. Write the study in `src/`, put the number in the balance lab as a check
(or in the sim as a tuning constant), and cite the study next to it, as `faceoffs` and
`form` do. Change the rules until the lab is green with a fixed seed.

## Models (machine learning)

Train with scikit-learn (XGBoost if it earns it), split by season or by league, never by
row, and export a table in the format from
[`docs/MODEL_CONTRACTS.md`](../docs/MODEL_CONTRACTS.md). Compare against the rules default
with a fixed seed in the lab before switching.

- **Stats to ratings** (`gm-stats-to-ratings`): trained on simulated leagues (the data
  `pnpm ratings:fit` produces, no licence issue), held out by league. Version 2 (per-game and
  workload features, 120 leagues) is in; a replacement must beat its R² per key; goalies
  (0.24-0.32) have the most room.
- **Development** (`RulesDevelopmentConfig`): trained on NHL careers with player fixed
  effects (or imputation) against survivor bias; an `AgingCurve` per position plus
  retirement, with `noise` from the spread between careers. Shipping waits on data rights;
  until then `aging` sets the targets the hand-set curves are fitted to in the balance lab
  (all three age bands in range).

## Next studies
- "Better team wins a best-of-7" back above its floor (about half a point under since goalie form)
- Shot quality: goal rate by distance, angle and type, to check the rules `gm-xg-table`
- Trade and contract anchors (rental tiers, pick prices, asks in percent of cap) as spot checks
- Playtest analysis: `python3 -m ml.src.playtest <save>` is done; run it on playtesters' saves before Early Access

A third model needs a lab check that shows the rules falling short in a way players
would notice, and data we have rights to.

## Setup

None: everything here uses only the Python 3.11+ standard library. Run the commands above
from the repo root.
