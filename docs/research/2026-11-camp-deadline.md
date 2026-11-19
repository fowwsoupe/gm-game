# Camp and a trade deadline that matters: design brief (2026-11)

The roadmap's "camp and a trade deadline that matters wait for trades" (Season calendar, M6).
Trades, team statuses and fire sales are in, so both can start. This brief says what is missing
today and splits it into two jobs. Camp battles, summer training plans and the international
tournament stay with the Phase 2 headline of their own; minor-league moves (waivers, sending a
junior back) stay with the minor / junior leagues brief.

## What the real league does

- **Camp.** NHL training camps open about three weeks before opening night (mid-September for
  an early-October opener), with a handful of exhibition games. Rosters must be down to the
  23-man limit by opening night (`roster.maxActive`; the [Sports GM research](2026-11-sports-gm-research.md#gaps-to-close-before-committing-numbers)
  lists that limit among the rules still to verify). A holdout is a player who does not report
  to camp: William Nylander missed all of camp in 2018 and signed on December 1.
- **The deadline.** Early March, about three quarters of the way through the regular season.
  At the 2026 deadline thirteen teams bought and seven sold; a good top-six or top-four rental
  went for about a first-round pick, depth rentals for a 2nd to a 4th (the rental pricing
  in the [Sports GM research](2026-11-sports-gm-research.md#trade-value-needs-four-separate-price-signals),
  from Daily Faceoff's recap). A contender pays that because the playoff run is most of what it
  is buying. Players signed as free agents after the deadline cannot play in the playoffs.
- Camp timing, the Nylander holdout and the post-deadline eligibility rule are general
  knowledge, not from a sourced report: check them before any of them becomes a number in the
  ruleset.

## What exists today

| Piece                            | Status                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Preseason phase                  | in the calendar (`preseasonDays: 21`, `phaseOf` returns `preseason` for negative days) but never reached: `create.ts` and `season.started` put the date on day 0, and `finishRollover` goes straight from the offseason to `regular` |
| Holdouts, owner's preseason talk | both on day 0 (`startHoldouts`, `preseasonMeeting`), so a holdout and the season's objectives land the night the games start                                                                                                         |
| Season form                      | drawn at `season.started`, hidden from everyone ([spread brief](2026-11-spread-second-mechanism.md): "showing form to the human: later")                                                                                             |
| Roster size                      | `rosterShort` To do for a position under its minimum; nothing for a roster over `maxActive` (AI teams stay under it on their own)                                                                                                    |
| Deadline                         | trades close after `tradeDeadlineDay`; Home's To do counts down the last 14 days; the owner checks in 14 days before; "Sim to trade deadline" on the sim bar                                                                         |
| AI trade talks                   | weekly with the league pulse, at most one trade a week, the same cadence in October as in deadline week                                                                                                                              |
| Rental value                     | this season's weight is `now x seasonLeft`, the regular season's share left (`trades/evaluate.ts`): at the deadline (day 140 of 190) a rental is worth 26% of a season to everyone; the playoff run counts for nothing               |
| After the deadline               | AI offers to the human stay open past it (they fail on accept); free agents can still be signed until the playoffs start, a way round the deadline                                                                                   |
| Lab                              | no trade line at all                                                                                                                                                                                                                 |

So the deadline is a date that closes a window, not a market: rentals are cheap to buyers and
sellers alike, AI teams trade at the same pace all year, and a human can sign past the deadline.

## Design

**Camp is three real weeks.** A new season (and a new league) opens on day `-preseasonDays`,
in the preseason phase; no games are played until day 0. Trades and signings are open. Holdouts
start on camp's first day (he skips camp, and you have three weeks to settle it before games),
and the owner's preseason meeting moves there too, so objectives and the budget are known while
you can still act on them (the month settles on day 0 as now). On the last camp day the human
team's head coach files a camp report: his read of the team's form, in three words (sharp, as
expected, flat), off by noise that shrinks with his quality (SD `(1 - quality) x form SD`). The
form itself is not shown, only his read, so a poor coach can be wrong. A roster over `maxActive`
gets a "cut to 23 by opening night" To do. AI teams get no report: they act on the standings.

**The playoff run counts in rental value.** This season's weight becomes
`now x (playoffShare + (1 - playoffShare) x seasonLeft)`, with `playoffShare` by status
(contender 0.5, buyer 0.3, bubble 0.1, others 0; game numbers, tuned in the lab). Before the
season it is unchanged (`seasonLeft` is 1); at the deadline a contender's rental still weighs
0.63 of a full season (before its `now` weight) while a seller's weighs 0.26, so rentals move
from sellers to buyers.

**Deadline week is a market.** In the last seven days up to the deadline, AI trade talks and AI
calls to human teams run every day instead of once a week (same chances, same rules), so the
league can make several trades in the final week. Open offers expire at the deadline. On
deadline day the feed posts a recap (trades that week, the biggest buyer). After the deadline,
free-agent signings close until the champion is crowned, except a team under a position
minimum, which may sign one player to fill it (the game tracks no playoff eligibility, so it
closes the door the NHL closes with eligibility).

## Jobs (one PR each, in order)

1. **Camp.** `season.started` carries the day it opens on (absent in old saves: day 0), set to
   `-preseasonDays`; `create.ts` opens there too; `finishRollover` changes phase to
   `preseason`. Holdouts and the preseason meeting on camp's first day; the coach's camp report
   (news for the human team, strings in `en.ts` and `fr.ts`); the over-roster To do; "Sim to
   opening night" on the sim bar. Every rule keyed to day 0 or `day >= 0` (finance settling,
   `teamContext`'s `inSeason`, the weekly pulse) is checked to still be right on negative days.
   _Done when:_ a test opens a season on day -21 in the preseason with no games until day 0, a
   holdout starting on day -21, and an elite coach's camp read right more often than a poor
   one's; the lab is flat on seeds 1, 101 and 201 (camp plays no games).
   _Done._ The over-roster To do was left out: every team carries 25 players (the generator
   and free agency fill to that), and nothing can cut a player in camp, so it would show every
   season with nothing to do about it. It waits for waivers (minor / junior leagues brief).
   An unhurt player's `injuredUntil` no longer reads as day 0 (camp days are negative).
2. **The deadline.** `playoffShare` in the valuator; daily AI talks and calls in deadline week;
   offers expire at the deadline; the deadline-day recap; signings closed after the deadline
   (with the position-minimum exception). A report-only lab line for AI trades a team-season and
   the share made in deadline week.
   _Done when:_ a test values a top-six rental at the deadline near a late first-round pick for
   a contender and under a 2nd for a seller (the cited tiers); the lab shows the deadline-week
   share up and every other check flat on seeds 1, 101 and 201, before and after pasted in the
   PR.
   _Done._ The share is in the valuator's horizon table (`HORIZON.playoffs`); deadline week is
   the seven days up to and including the deadline (`inDeadlineWeek`). No offer is made on
   deadline day itself (it would close the same night). The recap's biggest buyer is the team
   whose incoming players' overall most beats its outgoing players' that week; a new
   `seasonTrades` list (cleared each season) keeps the day of each trade for it.

Not in scope: exhibition games, camp battles for roster spots, professional tryouts, waivers,
playoff eligibility, a deadline-day show (that is cutscenes and media). The lab's real-NHL
trade volume (total trades and the deadline-day count) is not in a sourced report yet, so the
new lab line stays report-only until one is added.
