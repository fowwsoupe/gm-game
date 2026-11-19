# Free-agency bidding war and contract negotiation: design brief (2026-11)

The roadmap's Phase 2 headline "Free-agency live bidding war + full contract negotiation" (queue
D). FEATURE_SPEC asks free agency for a "live bidding war; pitch your team; decisions take days"
and contracts for "negotiation by personality and agents (design later)". This brief is that
design (it settles the roadmap's open decision "Contract negotiation design"): what exists, what
is missing, and three jobs. NHL only; every rule is sport-neutral and reads its numbers from the
ruleset.

## What the real league does

- **The market.** Unrestricted free agency opens on July 1. The top free agents often agree on
  the first day; others wait days or weeks while the market settles, and the asks of players
  still unsigned late in the summer come down (some go to camp on a tryout). In recent summers
  teams had a short window before July 1 to talk to other teams' pending free agents without
  signing them.
- **Agents do the talking.** A team makes an offer, the agent answers or counters, and
  reporters relay how many teams are in and who the finalists are; the terms are rarely public.
- **More than money.** A player weighs term, the team's chances, his role and where he will
  live: John Tavares chose his hometown Toronto in 2018. Term and cap hit trade against each
  other: a veteran who wants security takes a lower cap hit for more years, and a young player
  charges more for a long deal, since it buys his free-agent years.
- **Re-signing.** A player can sign an extension in the last year of his deal. Restricted free
  agents have less leverage (offer sheets are rare), and some go to arbitration.
- **Terms.** From 2026-27 the 2025 MOU caps terms at 7 years to re-sign and 6 to sign elsewhere
  (`maxYearsResign`, `maxYearsNewTeam`, from the [Sports GM research](2026-11-sports-gm-research.md#the-2026-27-rulebook-is-concrete-enough-to-code-today)).
  The same report's NHL 26 complaints include contract demands inflated after one good season
  and players with no destination preferences ([Immersion](2026-11-sports-gm-research.md#immersion-comes-from-systems-that-remember)).
- Apart from the terms, all of this is general knowledge, not from a sourced report: check the
  market timing, the pre-market window under the 2025 MOU and the term-for-cap-hit trade before
  any of them becomes a ruleset number.

## What exists today

| Piece          | Status                                                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interest meter | `signingInterest` (`offseason/signing.ts`): money (against the ask), winning (team status), role (better players at his position), term (years against `wantedYears`), weighted by age and tilted by greed and ambition; loyalty and hometown pulls |
| Threshold      | a constant 70 (`THRESHOLD`), the same for every player, sent to the UI with his exact interest: the cheapest deal is found by moving the salary until the bar crosses the line                                                                      |
| Asking price   | `contractDemand.ask`: one market curve by overall (`value/market.ts`), the same for every team                                                                                                                                                      |
| Human offers   | `contract.sign` (salary, years, no-trade clause, signing bonus): he signs at once if no AI team bids, else the offer joins theirs. An offer under the line is a command error with no trace, so retrying costs nothing                              |
| AI offers      | `makeOffers` (`offseason/market.ts`): each AI team with a need offers once a day, at the ask times a drawn premium (1 to 1.15, plus or minus 0.08 by GM lean, plus 0.05 for a contender), and never raises                                          |
| Decisions      | `decideOffers`: the next market day a free agent signs the offer he likes best (a restricted one's becomes an offer sheet); a human team that lost him gets the news                                                                                |
| Market days    | `freeAgency.advanceDay` as often as the human wants, then `finishRollover` runs `MARKET_DAYS` (5) more and settles everyone; no day counter in the state                                                                                            |
| Rivals         | the profile's `rivalOffers`: a count of AI offers, no teams, no standing                                                                                                                                                                            |
| Re-signing     | `contract.resign` takes years only: the price is `resignAsk` (the ask, 75% for a restricted player), any legal term, always yes for a human. AI teams re-sign by `stayChance` (loyalty, ambition, team status)                                      |
| Personality    | six traits hashed from the id; greed and ambition tilt the meter; temperament is used by locker-room chemistry; `PRIORITIES` lists a mentor, unused                                                                                                 |
| Promises       | disputes (human teams): a role promised by day `until` (`PROMISE_DAYS`, 30), broken = a trade request; cleared at `season.started`                                                                                                                  |

So the market is one sealed round: AI teams bid once at a random premium and never answer each
other, a contested star decides overnight, the human reads the exact line off the meter, and a
human re-signs anyone at the market price.

## Design

**The bidding war: decisions take days, and teams answer each other.** The state gets a market
day (`marketDay`, in the save's JSON meta like `faOffers`; 0 when free agency opens), moved by a
new `freeAgency.dayPassed` event at the start of each market day (new event kinds go in
`packages/shared` first). Each offer remembers the market day its team first bid (`since` on
`FreeAgentOffer`; the reducer keeps it when the team raises, since `freeAgency.offered` already
replaces a team's earlier offer). A free agent with one team's offer decides the next day, as
now. With offers from two or more teams he decides `freeAgency.days` market days (ruleset, 2)
after his first offer; the summer's last `decideOffers` in `finishRollover` closes every race.
Until then his agent tells each bidder where it stands: the leading offer's interest (the meter
number, not its terms) and whether it leads. On each market day, after the due decisions and
before new offers, an AI team that trails raises its salary by `freeAgency.raiseStep` (5% of his
ask), once a day, while the new salary stays at or under its walk-away and still passes `roomFor`
and `signFreeAgent` (roster spot, cap room, CBA). The walk-away is the ask times
`freeAgency.maxPremium` (1.2) plus today's `LEAN_PREMIUM` by GM style and the contender premium:
about 1.33 for a win-now contender, 1.12 for a builder, so it is never below a first offer.
Raises draw no random numbers. The human raises by sending a new offer, as he can today. The
profile sends the human the teams bidding, the best rival interest and the days left, in place of
the `rivalOffers` count. A player who signs after three or more teams bid makes the feed as a
bidding war (a `news.posted` headline, en and fr).

**Negotiation: a hidden line, an agent who counters, and patience.** His line is the interest he
signs at: `freeAgency.line` (70, today's `THRESHOLD` moved to the ruleset) plus
`(greed - 0.5) x 2 x freeAgency.lineSwing` (5), so 65 for the least greedy player and 75 for the
greediest, the same for every team. The meter keeps his interest and its reasons but no longer
shows the line (`threshold` leaves `SigningInterest`). An offer at or over the line signs him (or
joins the race, as now). Under it his agent counters: the lowest salary, at the offered term,
clause and bonus, that puts his interest at his line plus `round(greed x freeAgency.markup)` (6),
since an agent asks a little more than his client would take. The money score is linear in
salary until it tops out at 1.5, so the counter is one line of arithmetic; when no legal salary
gets there (a winner-chasing veteran and a rebuilding team), there is no counter, only the factor
holding him back (his weakest score: "it's not the money: he wants a winner"). Patience is
`1 + round(freeAgency.patience x temperament)` rounds (4: one round for a hot head, five for the
calmest). An offer under his line spends a round; a lowball, more than `freeAgency.lowball` (15)
points under it, spends two. With none left he breaks off talks with that team until free agency
opens again or the season starts (`talks` by player and team in the state and the save meta,
cleared on `freeAgency.opened` and `season.started`). Since a refused offer now changes state, it
stops being a command error: `contract.sign` answers with a new `contract.countered` event (the
counter if any, the rounds left). AI teams never spend patience: an AI offer under his line is
raised to the counter when that is within its walk-away, else the team moves on, as today. The
line's mean is today's 70, so AI teams should sign about as many players as before; the lab says.

**Re-signing negotiates the same way.** `contract.resign` takes the same offer as `contract.sign`
(salary, years, an optional clause and bonus; the command shape changes in `packages/shared`
first) and goes through the same meter and line for the team he plays for, with `resignAsk` as
the money base and the loyalty pull counted for that team. Over his line he signs (an extension
in season, as now); under it his agent counters; out of patience he will not re-sign before free
agency opens, where his team can still bid like anyone else, with his loyalty pull. AI re-signing
stays as it is (`stayChance` at his ask), which keeps playoff turnover where the lab has it. The
Cap screen's re-sign row opens the same offer card as the Free Agency screen.

**The room and the pitch.** While the market is open the Free Agency screen is a room: the board
of free agents best first (ask, the teams bidding, the leading interest, the days to his
decision, your standing), the day button, and the day's signings and raises from its events. One
new `GmApi` query (`freeAgencyBoard`, rows built in the sim from `faOffers`, `signingInterest` and
`marketDay`), screens from `ui/` components. The room says that starting the season plays
`MARKET_DAYS` more days with your offers as they stand. The pitch is a promised role: an offer
can carry `promiseRole`, the top of his position on your depth chart. For that offer his role
scores 100 on the meter. If he signs, the promise is kept (`rolePromises`, save meta) until day
`PROMISE_DAYS` of his first regular season with you; then, if he is not first at his position in
your depth order, a dispute opens at once (`player.disputeStarted`) and the disputes' own talk,
promise and trade-request rules take over. One open promise per position on a team (only one
player can be first), human teams only, as disputes are.

## Jobs (one PR each, in order)

1. **The bidding war.** `freeAgency` in the ruleset (`days`, `raiseStep`, `maxPremium`),
   `marketDay` and the `freeAgency.dayPassed` event, `since` on offers (reducer and
   `SaveFile.persist`), decision days in `decideOffers`, AI raises in `marketDay`, the profile's
   bidders and standing on the offer card, the bidding-war news (en, fr). Two report-only lab
   lines: contested signings a summer, and their salary over the ask (mean).
   _Done when:_ a test gives a star free agent offers from two AI teams: he waits
   `freeAgency.days` market days, the trailing team raises at least once and never past its
   walk-away, and he signs the best interest; a depth player with one offer still signs the next
   day; a replay gives the same summer. The lab's cap, floor and contract checks stay at 0 and the
   rest are flat within seed noise on seeds 1, 101 and 201, before and after pasted in the PR
   (AI salaries move).
2. **Negotiation.** `line`, `lineSwing`, `markup`, `patience` and `lowball` in the ruleset, the
   personal line in `signFreeAgent`, the counter and the `contract.countered` event, `talks` in
   the state and the save, AI offers raised to the counter, `contract.resign` through the meter,
   the offer card's reply and rounds left on both screens (en, fr).
   _Done when:_ a test sends an offer under his line and the counter it returns signs him when
   sent back; a greedy player's line is above a modest one's; a calm player hears more offers
   than a hot-headed one before talks break, a lowball spends two rounds, and broken talks reopen
   at `freeAgency.opened`; a re-sign under his line is countered and one over it extends him. AI
   signings a summer are within seed noise and the lab is flat on seeds 1, 101 and 201, before
   and after pasted in the PR.
3. **The room and the pitch.** The `freeAgencyBoard` query and the room screen, `promiseRole` on
   the offer, `rolePromises` in the state and the save, the promise check on day `PROMISE_DAYS`
   (en, fr).
   _Done when:_ a test scores a promised role 100 on the meter; a signed player who is not first
   at his position on day `PROMISE_DAYS` opens a dispute and one who is first does not; a second
   promise at the same position is refused; the board lists the bidders and the days left. The
   lab is unchanged (human teams only).

Not in scope: agents as people with several clients (the agent is the player's greed and
temperament), salary arbitration and qualifying offers, salary by year (a contract has one cap
hit), the pre-market talking window, the mentor priority (still unused), the assistant GM reading
a player's line (his accuracy rule would fit; later), and AI teams negotiating their own
re-signings.
