# M1 MoneyPuck prototype report

Run date: 2026-11-14. Source: [MoneyPuck's published downloads](https://moneypuck.com/data.htm),
2022–23 through 2025–26 regular seasons. This is an internal analysis prototype.
Commercial ML training and shipped-model rights are pending review. No raw records or
real-player rosters are committed to the repository.

## Coverage and quality

| Input                                             |    Rows |
| ------------------------------------------------- | ------: |
| Games                                             |   5,248 |
| Unblocked shots                                   | 453,000 |
| NHL player seasons                                |   4,141 |
| Team seasons                                      |     128 |
| Junior/European player seasons, drafts, contracts |       0 |

The adapter used the source's winner field for 382 games whose recorded goal totals
were tied, generally after a shootout. One game's winner field disagreed with its
recorded goals; the goals determined the winner for that game. Six shots lacked a
shooter ID and received event-specific placeholder IDs. Four y-coordinates rounded
to ±43 feet were clamped to the rink's ±42.5-foot boundary. These counts are printed
by `python3 -m ml.src.moneypuck` and should be checked again on every source update.

## Descriptive results

Goal rate among **unblocked attempts**, including misses:

| Shot distance   | Attempts | Goal rate |
| --------------- | -------: | --------: |
| Under 20 feet   |  138,039 |    12.36% |
| 20–40 feet      |  152,861 |     7.29% |
| 40 feet or more |  162,100 |     2.51% |

For 95 same-team consecutive-season pairs, correlations of the first season's
metric with next season's win percentage were: goal difference/game **0.575**,
xG difference/game **0.516**, unblocked-shot difference/game **0.489**,
shooting percentage **0.306**, and save percentage **0.279**. These are univariate
correlations, not independent effects or causal estimates.

For 1,408 skater-season pairs with at least 600 minutes in both seasons, first-season
xG/60 correlated **0.823** with next-season goals/60. Primary assists/60 had a
year-to-year correlation of **0.721**. Finishing above xG/60 had a year-to-year
correlation of **0.323**. Faceoff win percentage repeated at **0.748** among 440
pairs with at least 100 draws in both seasons. Hits/60 repeated at **0.906**, which
shows a repeatable style and does not establish a contribution to winning. Among 162
goalie-season pairs with at least 1,000 minutes in both seasons, goals saved above
xG/60 repeated at **0.114**.

The generated full report is `ml/data/processed/rating_evidence.json` on this machine.
It includes sample counts, all measured correlations, and shot-type rates.

## Season-held-out study

The [reproducible study](../ml/src/study.py) fits fixed, standardized ridge models
for team and player outcomes using only earlier seasons, then evaluates on the next
season. Shot models use smoothed frequency bins. It does not randomly split games
or players across train and test. Root mean squared error (RMSE) is smaller when
predictions are better. Each team holdout has 31–32 teams, so model rankings are
sensitive to a single season.

| Outcome and model                                         | 2023–24 inputs → 2024–25 | 2024–25 inputs → 2025–26 |
| --------------------------------------------------------- | -----------------------: | -----------------------: |
| Next-season team win percentage: training mean RMSE       |                   0.0996 |                   0.0818 |
| Team win percentage: prior goal difference RMSE           |                   0.0773 |                   0.0864 |
| Team win percentage: prior unblocked-shot difference RMSE |                   0.0868 |                   0.0773 |
| Team win percentage: prior xG difference RMSE             |                   0.0831 |                   0.0804 |
| Next-season skater goals/60: prior goals/60 RMSE          |                   0.2476 |                   0.2653 |
| Skater goals/60: prior xG/60 RMSE                         |                   0.2332 |                   0.2672 |
| Skater goals/60: all measured features RMSE               |                   0.2185 |                   0.2452 |
| Next-season goalie GSAx/60: zero baseline RMSE            |                   0.3413 |                   0.2947 |
| Goalie GSAx/60: prior GSAx/60 RMSE                        |                   0.3331 |                   0.2980 |

For shot goals, a model using distance, angle and shot type trained on earlier
seasons reduced Brier score from **0.065433 to 0.062681** for 2024–25 and from
**0.066926 to 0.064418** for 2025–26, compared with a constant goal rate. MoneyPuck's
own xG score is a useful reference, but its training seasons are unknown and it is
not an independent held-out benchmark for our feature choice.

The team win predictor ranking reversed between the two holdouts; there is no
robust winner among these simple team metrics. The skater result is more stable:
combining shot generation, finishing, assists and on/off measures improves goals/60
prediction over a single prior stat. On/off measures can carry team and usage
effects. Players appear in more than one season pair, and the 600-minute filter
excludes short-career and low-usage players. These models are predictive checks,
not estimates of independent skill value or causal effects on wins. Goalie GSAx
also includes team defensive and usage effects. The generated details are in
`ml/data/processed/predictive_study.json`.

## Rating decision

This supports keeping shot generation/finishing and playmaking as distinct concepts
for the next prototype. Faceoffs look repeatable enough to test as a separate center
skill; this report does not measure their effect on team wins. It does not support
splitting shooting into accuracy and power because this dataset has shot type but no
direct power measure. The weak goalie year-to-year result argues against treating
observed save percentage as a precise `consistency` estimate. Skating speed,
controlled entries, injury risk and development are absent.

The [rating list](RATINGS.md) is now v2 in code: the existing keys plus `faceoffs`, kept provisional until its effect on team results is tested.
Junior/European seasons, drafts and contracts remain missing from the original M1
data scope. The team may decide to move them later, but that scope change has not
been agreed. This study does not infer real-player ratings or justify shipping
source-derived model weights.
