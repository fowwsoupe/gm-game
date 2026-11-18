# Advanced stats design (hockey draft)

Community roster files provide players and hidden ratings. They do **not** need real
player statistics. The game will produce its own stats from simulated events. Historical
data and published research inform the formulas and calibration, but are not shipped
as player records. The [M1 NHL study](research/2026-11-m1-moneypuck-study.md) is one calibration input.

## Shared shape, sport-specific measures

Every sport can record a season, team/player ID, games, playing time, situation,
sample size and a map of numeric stats. The shared event and save contracts stay
sport-neutral. Hockey defines the keys and formulas below; a future basketball or
football module defines its own. A stat carries its unit and sample context, so a
rate is never confused with a count. Missing observations stay missing rather than
becoming zero.

| Hockey measure                        | Definition                                                              | Unit and use                                                |
| ------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| Goals, primary assists, shots on goal | Counts from game events, excluding shootouts from player scoring totals | Count; basic box score                                      |
| Unblocked attempts                    | Goals + saved shots + misses                                            | Count; shot volume                                          |
| xG                                    | Sum of pre-shot goal probabilities                                      | Expected goals; shot quality, not a player rating           |
| Goals above xG                        | Goals − xG                                                              | Count or per 60; noisy finishing estimate                   |
| xG for/against                        | Team xG while the player is on the ice                                  | Expected goals; needs ice-time and situation context        |
| xG share                              | xG for ÷ (xG for + xG against)                                          | Fraction; undefined when both are zero                      |
| On/off xG-share gap                   | On-ice xG share − off-ice xG share                                      | Percentage-point context; confounded by usage and teammates |
| Goals saved above xG                  | xG against − goals against while a goalie plays                         | Expected goals; noisy over one season                       |
| Faceoff win rate                      | Wins ÷ (wins + losses)                                                  | Fraction; undefined without draws                           |

Use `60 × count ÷ minutes played` for per-60 rates, only when minutes played is
positive. Store raw counts and minutes first; calculate rates for display and
analysis. Split even strength, power play, penalty kill and other situations before
combining them. Keep game winners separate from recorded goals because shootouts can
decide tied games.

These observations describe outcomes. The hidden ratings in [RATINGS.md](RATINGS.md)
are inputs to the sim, and no single observed stat is a direct measurement of one
rating. Community authors can supply ratings now. A stats-to-ratings converter v1 exists
(`ratingsFromStats`, [MODEL_CONTRACTS.md](MODEL_CONTRACTS.md) §5): it reports an uncertainty
that widens when the sample is small. Using it in roster import belongs to M4.

The NHL study found that shot geometry predicts goals in held-out seasons and that
skater shot generation and playmaking measures help predict later scoring. Team win
predictors varied by holdout season, and goalie goals-saved-above-xG was unstable.
These findings guide sim tuning; they do not set player ratings or establish causal
effects on wins.
