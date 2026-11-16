# M1 data access

Status: **commercial rights not yet reviewed** (2026-11-14). A MoneyPuck internal
prototype is staged locally and summarized in [the M1 report](M1_PROTOTYPE_REPORT.md).
The team chose to do the internal M1 analysis now and review commercial model and
shipping rights before using the results in a released game.
The local import and analysis workflow is in [`ml/README.md`](../ml/README.md).

## Coverage and rights to obtain

M1 needs play-by-play shots with coordinates, NHL player seasons, junior and European
player seasons, draft history and contracts. An acceptable agreement should explicitly
cover local collection and storage, cleaning and joining datasets, machine-learning
training and validation, use of derived ratings or model weights in a **commercial**
fictional hockey game, retention periods, and required attribution. Ask separately
about redistribution of raw records; the current plan does not ship them.

| Candidate                                                                                    | Published terms and M1 fit                                                                                                                                                                                                                                                                                                                                          | Next action                                                                                                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [NHL services](https://www.nhl.com/info/terms-of-service)                                    | Terms restrict unauthorized automated collection and commercial use. NHL play-by-play and draft data could cover part of M1, but the public terms are not permission for this pipeline.                                                                                                                                                                             | Ask the NHL for written data and ML rights through its [contact form](https://www.nhl.com/info/contact-us). |
| [MoneyPuck downloads](https://www.moneypuck.com/data.htm)                                    | Free use is non-commercial; other purposes require contacting MoneyPuck. It has shots and player/team files, but does not cover junior/European seasons and contract history.                                                                                                                                                                                       | Request commercial training and shipped-model rights at the address on its data page.                       |
| [Elite Prospects API](https://developer.eliteprospects.com/legal/terms)                      | Offers junior/European coverage, but its standard terms expressly exclude AI and ML training without a separate written agreement.                                                                                                                                                                                                                                  | Ask about a separate ML agreement only if its scope and cost fit.                                           |
| [Sportradar hockey APIs](https://developer.sportradar.com/ice-hockey/docs/nhl-ig-api-basics) | B2B NHL and global hockey APIs may cover multiple leagues. Published API documentation does not establish training or shipped-model rights.                                                                                                                                                                                                                         | Request a quote and a written list of covered leagues, seasons, fields and ML rights.                       |
| [Hockey Databank archive](https://github.com/rippinrobr/hockey-databank#the-hockey-databank) | Its notice allows commercial products with a prominent credit, but this 2018 archive is mostly historical major-league box scores and team/player tables. It is not a complete source for M1's play-by-play, junior/European seasons or contracts. Its acknowledgements include other data sources, so confirm rights for the intended ML use before relying on it. | Consider only as a supplementary historical source after rights review.                                     |

Do not use Hockey-Reference or Sports-Reference for model training under its
[data-use terms](https://www.sports-reference.com/data_use.html). The
[Stathletes Big Data Cup terms](https://github.com/bigdatacup/Big-Data-Cup-2026/blob/main/legal.md)
limit use of resulting research to non-profit purposes, so that dataset is not a
commercial-game workaround.

## Request text to send to a data provider

> We are building a commercial, fictional hockey management game. We want to license
> historical hockey data for internal analysis and model training. We would use game
> play-by-play with shot locations, player seasons across the NHL and junior/European
> leagues, drafts and contracts. We would store raw data privately, create cleaned
> training tables, train and validate models, and ship only derived model weights or
> rating rules in the game, without distributing your raw records or real-player
> rosters. Can you confirm which of these uses your agreement permits, the covered
> leagues/seasons/fields, retention and attribution rules, and pricing? Please flag
> any limits on commercial ML training or distribution of derived models.

The team should retain the provider's written reply or agreement outside the repo
and record its scope in `ml/data/raw/normalized/source.json`. Decide whether the
current prototype outputs can be used for commercial ML; if not, replace the inputs
and rerun. Then inspect data quality and bias, agree the rating list in
[`RATINGS.md`](RATINGS.md), and update the shared roster contract together.
