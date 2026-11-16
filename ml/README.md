# ml/

Python is used for **training only**. The shipped game never runs Python.

```
ml/
  data/raw/         # downloaded historical data (git-ignored)
  data/processed/   # cleaned features (git-ignored)
  notebooks/        # exploration
  src/              # training scripts
../models/          # exported .onnx files the game loads (committed, keep them small)
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
`shots_2025.zip`, `skaters_2022.csv` through `skaters_2025.csv`, and `goalies_2022.csv`
through `goalies_2025.csv` in `ml/data/raw/moneypuck/`, then run:

```bash
python3 -m ml.src.moneypuck --seasons 2022 2023 2024 2025
python3 -m ml.src.pipeline --raw ml/data/raw/normalized --processed ml/data/processed
python3 -m ml.src.analyze --processed ml/data/processed
python3 -m ml.src.study --processed ml/data/processed
python3 -m ml.src.faceoffs --processed ml/data/processed
```

`faceoffs` writes `faceoff_study.json`: goal diff/game per SD of team faceoff %, raw (an upper
bound) and after prior-season goal diff. It calibrates the sim's `FACEOFF_WEIGHT`; the balance
lab's "Faceoff effect" check measures the same number in the sim.

The adapter filters playoffs, normalizes shot coordinates and positions, preserves
shootout winners, and records source inconsistencies. Its drafts and contracts files
are header-only because MoneyPuck does not supply them. It also cannot supply junior
or European player seasons. The [prototype results](../docs/M1_PROTOTYPE_REPORT.md)
include the season-held-out study. Raw and processed files remain git-ignored;
**commercial ML and shipped-model rights are still pending**.

## Later model workflow

Build features from fields available to the game. If a model needs something the game
doesn't track, it can't be used in-game. Train with scikit-learn / XGBoost / PyTorch,
export to ONNX in `../models/`, and compare against the rules-based fallback with fixed
seeds before switching.

## Good first models

- Expected goals per shot (shot quality)
- Player development / aging curves
- Player value for AI trade and contract logic

Keep the rules-based sim as the fallback, and compare every model against it with a
fixed seed before switching.

## Setup

```bash
cd ml
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
```
