# 0005: Calibrate the rules first; machine learning only where a fit is needed

Status: accepted (2026-11-16). Narrows the ML plan in 0001 and 0003; their interfaces stay.

## Context

The plan was for trained models (xG, development, value, contract demands, clustered builds)
to replace every rules-based default behind `Models`. After M1–M8, none had shipped and the
game plays the full loop on rules. Looking at each area:

- **Stats to ratings.** Needed: a community roster arrives as stat lines, and the mapping back
  to hidden ratings is many-to-many and noisy. It is fitted on the sim's own seasons, so there
  is no data-licence question. Today's fit is linear and weak for goalies (held-out R²
  0.25–0.36).
- **Development and aging.** Needed: published curves give a peak age, not skill-specific
  shapes or the spread between careers, and naive curves carry survivor bias (fixed effects
  or imputation fix it). The hand-set curves in `sports/hockey/aging.ts` are placeholders.
- **xG.** Not needed. The sim makes its own shots and has no rebounds or pre-shot events, which
  are what a tree model gains from, and the contract squashes any model into a 5-foot grid.
  Smoothed bins by distance, angle and type got most of the gain in the M1 study (Brier
  0.0654 → 0.0627). The lab's save % and goals targets matter more.
- **Value and contract demands.** No contract or trade data we may use, so nothing to train on.
- **AI GMs** are the headline feature and must explain themselves. A learned policy can't.
- **Builds.** The rules version reads fine; clustering would be cosmetic.

## Decision

- **Machine learning for two models:**
  1. **Stats to ratings** (`gm-stats-to-ratings`): trained on many simulated leagues
     (`pnpm ratings:fit` data), held out by league, must beat the current R² per key.
  2. **Development** (`DevelopmentModel`): trained on NHL careers with player fixed effects,
     exported as the `RulesDevelopmentConfig` shape (an `AgingCurve` per position, noise as the
     spread between careers). Shipping it waits on data rights (see M1_DATA_ACCESS.md); until
     then it only sets the hand-set curves' targets.
- **Everything else is calibrated rules:** real data and published research only **measure
  targets** (balance lab ranges, effect sizes such as faceoffs and goalie form, trade anchors).
- Both models ship as data the pure sim loads, and each must beat its rules default in the lab
  with a fixed seed before it is switched on. The rules default stays as the fallback.

## Consequences

- The ML owner's v0.1 work is two models plus calibration studies, not five models.
- Adding a model elsewhere needs a lab check that shows the rules falling short in a way
  players would notice, and data we have rights to.
- The data-licence question shrinks to the development model and the lab targets; it still
  goes to the lawyer.
