# Player traits and clustered builds: design brief (2026-11)

The last open part of the Players row (`sim/players`: "traits, clustered builds to do") and
FEATURE_SPEC's "percentile cards, builds, role tags, **traits**". This brief says why builds are
thin today, how real players' shapes come in, which play traits are worth a game lever, and
splits it into jobs. No new engine: builds stay behind `SportModule.role`, traits join the role
tags the player card already shows. No number below is measured yet; each job measures its own.

## What exists today

| Piece       | Where                                     | Status                                                                                                                                          |
| ----------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Ratings     | `sports/hockey/generate.ts`               | Every key is the player's base +- 8, drawn on its own (prospects too): no position or style shape, so every player is a generalist with noise   |
| Builds      | `sports/hockey/builds.ts` (`hockeyRole`)  | A rule picks the best-scoring of 5 forward, 3 defence and 2 goalie builds from the percentiles; `TODO(M4)`: clusters of real players replace it |
| Role tags   | same                                      | Top-10% single skills (shot, speed, vision...), at most two, shown on the player card                                                           |
| Builds fit  | `sports/hockey/strength.ts`               | A finisher with a creator on a line, an offensive with a home defenceman on a pair; `FIT_BASELINE` measured on generated leagues                |
| "Traits"    | `people/personality.ts` (`notableTraits`) | Personality only (loyalty, hot-headed...), shown next to the tags as `trait.*`. There is no play trait                                          |
| Development | `players/development.ts`                  | Every key moves by the same step each summer (plus 1 point of noise), so a shape a player is born with lasts his career                         |

Because the keys are drawn on their own, a "sniper" today is a player whose shooting die rolled
high, and builds fit separates teams only by luck of the dice (the baseline is 0.21 for
forwards, 0.12 for pairs). Clustered builds fix the cause: give players real shapes at birth.

## Clustered builds

1. **Find the shapes in real data (ml).** NHL skater seasons from MoneyPuck (the M1 study's four
   seasons, 600+ minutes), per-60 profile from the stats `docs/RATINGS.md` already ties to a key:
   xG (shooting), primary assists (passing), hits (physical), takeaways (defense, hockeyIq),
   on-ice xG against (defense), faceoff % (centres only). Z-score each stat within forwards and
   defence, subtract each player's own mean (the shape, not how good he is), then k-means with k
   picked by silhouette (forwards 3-6, defence 2-4). Output per cluster: a centre (offset per
   rating key, in SDs) and its share of players. Only these aggregate numbers ship, as a table in
   `sports/hockey/tuning.ts` with a link back here; raw data stays out of the build
   (non-commercial terms, [sports GM research](2026-11-sports-gm-research.md)).
2. **Generate from the shapes.** `generateFictionalLeague` and `generateProspect` draw a build by
   its share, then each key = base + centre offset x `SHAPE_POINTS` + a smaller die, with the die
   shrunk so a key's total spread matches today's. Offsets are centred on the share-weighted mean
   per key, so the league's average rating, overall and the lab's "League avg rating drift" do
   not move. Goalies keep the rule builds: public goalie stats split by shot danger are too noisy
   to cluster.
3. **Classify by the nearest centre.** `hockeyRole` takes the player's percentiles minus their
   mean and returns the nearest cluster's build. Build keys come from each centre's biggest
   offsets; existing keys (`sniper`, `playmaker`, `shutdownD`...) stay where a cluster matches,
   new ones get `build.*` strings in `en.ts` and `fr.ts`.
4. **Re-measure builds fit.** `FIT_BASELINE` is re-measured on the new generated leagues;
   `FIT_POINTS` stays, so the fit still only separates teams and an average team nets zero.

Imported rosters keep their own ratings (a real roster file carries real shapes; a stats-only
player is rated from his stats). Old saves keep their players; new prospects arrive with shapes,
so an old league is shaped within about ten drafts. No migration, no roster format bump.

## Play traits

A trait is a playing style you can watch, fixed for the player's career, that moves one lever
in the game sim and is neutral across the league. It comes from his id (like personality:
nothing stored, the same in every copy of the league) and shows on the player card as a tag
(`tag.*`, so it never collides with the personality `trait.*` keys). About one skater in five
has one. Each ships only if job 1 finds the style repeats in real data (year-to-year r of at
least 0.4); otherwise it is dropped, not tuned in.

| Trait                       | Who              | Lever in `game.ts`                                                                                                                 | Real-data check (job 1)               |
| --------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Net-front / perimeter       | skaters, 5% each | His shot distance draw narrows / widens (today `8 + abs(normal(0, 22))` for everyone): his shots come from closer in / farther out | Mean shot distance per player repeats |
| Disciplined / undisciplined | skaters, 5% each | His weight when the sim picks who takes a penalty (today `physical / 50`) x 2/3 / x 1.5                                            | Penalties taken per 60 repeat         |

Both are mean-neutral by construction (as many of one side as the other), so goals per game and
power plays per game should not move; they change who scores from where and who sits in the
box, which the box score and the shot map already show.

Not built, by FEATURE_SPEC's working rule (check fun ideas against real data first): clutch,
playoff performer and streaky scorer. No public study we know of finds them repeatable; we did
not measure it here either, so they wait for evidence. Handedness and spot fit (from shot
locations) need a new stored field, a roster format bump and a save migration: a later brief.

## Jobs (one PR each, in order)

1. **Clusters and trait evidence (ml).** `ml/src/builds.py`: the clustering above, the chosen k
   with its silhouette, centres and shares, and the year-to-year r for shot distance and
   penalties taken per 60. Numbers in a new dated report in this folder; the table lands in
   `tuning.ts`.
   _Done when:_ the script reproduces the table from the M1 data; each trait has its r and a
   keep or drop.
2. **Shaped generation and nearest-centre builds.** Generation, `hockeyRole`, strings and the
   re-measured `FIT_BASELINE`.
   _Done when:_ a test shows a new league's build shares within 3 points of the table's and
   key correlations of the right sign (a sniper's shooting over his defense); `pnpm lab` before
   and after: rating drift, goals per game, points % spread (seeds 1/101/201) and the builds fit
   lines stay in range.
3. **Play traits.** The kept traits from job 1: derived from the id, shown with the tags, the two
   levers in `game.ts`.
   _Done when:_ a test shows a net-front shooter's mean shot distance shorter and an
   undisciplined player taking more penalties than his teammates of the same physical; the lab's
   goals and power plays per game are unchanged.
