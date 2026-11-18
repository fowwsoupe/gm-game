# Owner & finance: design brief (2026-11)

The first Phase 2 headline. Hot seat and frustrated-owner events need an owner to be
frustrated and a coach to sit on the seat, so this layer comes before the event engine's team
events. This brief collects the real NHL money numbers, says which become ruleset data, and
splits the work into small jobs. The league stays fully fictional: generated owners, coaches
and cities, no real club, owner or arena names.

## What exists today

- `sim/finance` is structure only: `TeamFinances` (`cash`, five department budgets) and
  `emptyFinances()`. Nothing reads it.
- `sim/people` has GM profiles (style, skill) that `gmOf` derives from the team id when absent,
  so old saves and roster files work with nothing stored. Every summer `offseason/gms.ts`
  replaces some AI GMs: 15% leave, plus a 40% firing chance in the bottom quarter. There is no
  owner and no coach.
- Contracts carry a flat cap hit, a signing bonus (cash up front), performance bonuses
  (`bonuses.paid` at season end) and cap charges (buyouts, retained salary, bonus overage). The
  cash a team pays can be read from these. Cash and cap are the same amount but fall at
  different times.
- The ruleset has no money besides the cap. The season is 84 games (42 home dates). The
  fictional league has 16 teams and 8 playoff spots.
- Trade requests and holdouts already follow the "event with a choice" pattern (a start event,
  a talk command, personality decides). Owner cards copy it.

## Real NHL benchmarks

| Measure                      | Value                                                                 | Season  | Source                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Team revenue                 | mean $248M, median $235M, $161M to $431M (2.7x)                       | 2024-25 | [Forbes](https://www.forbes.com/sites/justinteitelbaum/2025/12/11/the-nhls-most-valuable-teams-2025/), table via [Wikipedia](https://en.wikipedia.org/wiki/Forbes_list_of_the_most_valuable_NHL_teams) |
| Operating income             | mean $74M, lowest $11M, no team below zero                            | 2024-25 | same                                                                                                                                                                                                   |
| Ticket sales, share          | 44% of league revenue (about $3B)                                     | 2022-23 | [The Hockey Writers](https://thehockeywriters.com/how-do-nhl-teams-make-money/), citing Sportico                                                                                                       |
| Other game-day spend         | 12% (concessions, parking)                                            | 2022-23 | same                                                                                                                                                                                                   |
| National media               | under $1.5B a year league-wide                                        | 2023-24 | same                                                                                                                                                                                                   |
| Team sponsorship             | $1.53B league-wide, +9% (about $48M a team)                           | 2024-25 | [SponsorUnited](https://www.sponsorunited.com/insights/nhl-marketing-partnerships-2024-25)                                                                                                             |
| Attendance                   | 23,014,458 over 1,312 games (17,540 a game), 96.9% of capacity        | 2024-25 | [NHL](https://www.nhl.com/news/nhl-sets-regular-season-attendance-record-in-2024-2025)                                                                                                                 |
| Largest crowd                | 21,105, every home date                                               | 2024-25 | same                                                                                                                                                                                                   |
| Average ticket (non-premium) | $88.84, +4.8%                                                         | 2023-24 | [Team Marketing Report](https://teammarketing.com/fci/2023-24-nhl-fan-cost-index/)                                                                                                                     |
| Playoff home game            | at least $1.8M gate; players get 35%, league $500K; team keeps ~$670K | 2019    | [LVSportsBiz](https://lvsportsbiz.com/2019/04/26/blown-game-7-call-costs-golden-knights-at-least-2-million-in-ticket-revenue-from-lost-round-2-home-games/)                                            |
| Head coach pay and term      | about $2.5M a year, usually three-year deals                          | 2024    | [ESPN](https://africa.espn.com/nhl/story/_/id/39659120/nhl-coaches-fired-more-nfl-nba-mlb)                                                                                                             |
| Coaches fired in-season      | 25 in five seasons (0.16 a team-season)                               | 2019-24 | same                                                                                                                                                                                                   |
| Head coach tenure            | 2.83 seasons on average (about 0.3 changes a team-season)             | 2000-23 | [The Win Column](https://thewincolumn.ca/2023/03/30/assessing-nhl-coaching-tenures-and-the-tendencies-for-teams-to-hire-new-coaches)                                                                   |
| Cap upper limit              | $88.0M                                                                | 2024-25 | [NHL](https://www.nhl.com/news/nhl-nhlpa-announce-team-payroll-range-for-2024-25)                                                                                                                      |

Derived here (arithmetic, not a sourced figure): capacity is about 18,100 a game (17,540 /
0.969). Non-player costs are about $86M a team (revenue $248M, less operating income $74M, less
a payroll near the $88M cap), about 35% of revenue. Changes a team-season come from The Win
Column's table (252 coaches over 23 seasons, one starting coach per team).

The shares come from different seasons and outlets and do not add to 100%. Local media has no
clean public number, so the game treats it as the remainder. Ticket share over attendance
(44% of $248M over 41 home dates of 17,540) implies about $150 a fan with premium seats
included, well above the $88.84 non-premium average. The game prices "a fan" at that blended
number.

## The model

All amounts are integer dollars. They are scaled from 2024-25 to the ruleset's season by the cap
ratio (104 / 88 = 1.18), since the cap is set from league revenue. A sandbox cap then rescales
the economy if the amounts are stored as cap fractions; the first job decides which (see
"Ruleset data").

### The owner

`OwnerProfile` in `packages/shared`. `ownerOf(team)` in `sim/people` derives it from the team id
when absent, like `gmOf`:

- **name**, generated from the fictional name lists. Those (`FIRST`, `LAST`) are private to
  `sports/hockey/generate.ts` today; `sim/people` is sport-neutral, so job 1 moves them to a
  shared place (or passes names in) rather than importing hockey code.
- **priority**, 0-1 from profit (0) to winning (1). It weights his objectives and how he reads
  a season.
- **patience**, 0-1. It scales how far confidence drops on a miss, and the length of a new
  GM's honeymoon (one season for the least patient, three for the most).
- **budget**, 0-1. How far toward the cap he lets payroll go, and whether he covers losses.
  A profit owner with a low budget is the "small-market, floor team" story.

Owners do not change hands in this headline. Sales belong to the sandbox and the empire.

### Revenue (per team, per season)

Market-driven lines scale with `team.market` (a 0.65-1.75 multiplier derived from the team id
when absent; tune it until the lab's revenue spread is 2-3x) and with fan interest (below).

| Line                | How it is computed                                                   | Starting value (2026-27)            |
| ------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| Gate                | attendance x ticket price, each home date                            | $160 a fan at the reference price   |
| Game-day spend      | attendance x spend a fan (concessions, parking, merch on the night)  | $48 a fan                           |
| Sponsorship & merch | yearly, x market x fan interest, renewed each summer                 | $59M at market 1, interest 50       |
| Local media         | yearly, x market x fan interest, renegotiated every 3 seasons (lags) | $23M at market 1, interest 50       |
| League share        | equal for every team (national media, league business)               | $59M                                |
| Playoff gate        | gate x a playoff markup, less the players' share and a league fee    | +15%; players 35%; fee $0.5M a game |

At 17,540 fans a date, these starting values give a market-1 team about $295M, with gate at
40% (the real mean of $248M x 1.18 is $293M). A playoff home date then nets about $2.5M
($3.3M gross gate, less 35% and the fee, plus game-day spend). The default league's eight-team
bracket is three rounds, so a run to the final is 6-12 home dates and adds $15-30M (the
16-team `NHL_2026` bracket has a fourth round and up to 16). That is the "revenue follows
winning" the spec asks for. It matters, but it does not flood a contender.

### Costs

- **Payroll, in cash**: each contract's cap hit over the season, signing bonuses on day one,
  performance bonuses when `bonuses.paid` fires, buyout and retained-salary charges in their
  season. This reuses the existing contract and `CapCharge` data. Nothing new is stored.
- **Staff**: the five `TeamFinances.budgets` (empty until the front-office headline gives them
  effects), the head coach's salary (about $2.5M, three-year deals), and the GM.
- **Arena and operations**: a fixed yearly amount plus a cost per home date. Together with
  staff they come to about 35% of average revenue (about $100M at 2026-27 scale).

Cash settles once a month for each team (`finance.settled`, one event a team a month with the
lines in it). That gives the money-flow chart its points without an event per game.

### Pricing policy and fans

- **Fan interest**, 0-100 per team. It rises with points % against last season, streaks,
  playoff rounds and star players. It falls with losing, a price above what the crowd will bear,
  and selling stars. About 70% of it carries into the next season, so a good year sells next
  year's tickets too.
- **Ticket price** is a policy, not a number per game. There are five steps (-20% to +20% around
  the league's reference), set any time with `finance.setTicketPrice`, and it takes effect at the
  next home date. Demand is capacity x f(fan interest, market) x price^-elasticity, capped at
  capacity. The decision is real: a cheap ticket fills a losing building and keeps interest from
  sliding, while a high one earns more only while the team wins. AI teams price by their
  owner's priority.
- **Capacity**: 16,000 to 21,105 by team (the top is the real largest crowd), fixed until a
  renovation project changes it.

Elasticity has no sourced value here. It is a tunable knob, like the right-shot premium in the
[sports GM research](2026-11-sports-gm-research.md). Do not present it as realistic.

### Owner meetings and decision cards

Three meetings a season, each a screen with one to three cards:

1. **Preseason**: the owner sets one or two objectives from his priority and from what is
   possible (the team's playoff odds and its plan). A rebuilding team is not told to win the
   Cup. He also sets the payroll budget.
2. **Trade deadline**: a check-in. If the team is on the bubble he may push to buy or to sell.
3. **Season end**: a review that grades the objectives, then the coach decision and next
   season's budget.

A card is data: an id, a trigger (a meeting, or an event such as a losing streak, a cash loss
or a star asking out), two or three options, and each option's exact effects (cash, fan
interest, confidence, budget, a project). This follows the existing pattern:
`owner.cardOpened` event, `owner.answerCard { cardId, option }` command,
`owner.cardAnswered` event. AI teams answer by owner and GM style, with no card shown. First
cards: raise prices, sell arena naming rights (cash now, fans down), spend to the cap for a
run, a fire sale when losing money, extend or fire the coach, start a project.

**Projects** run over several seasons: a cost each season, then an effect. Examples are an
arena renovation (capacity and fan interest up) and a fan festival (interest up for one season).
A practice facility waits for the front-office headline, which gives it something to change.

### Hot seat and firing

- **Confidence**, 0-100, is the owner's view of the GM. It moves at each meeting and a little
  each month with results against preseason expectation (points % against the power rating's
  projection), objectives met, profit against budget and fan interest. Patience scales the
  drops. A new GM gets a honeymoon floor.
- **The coach**: a minimal `CoachProfile` on `Team` (fictional name, hired season, salary,
  years). It has no effect on games yet; the front-office headline adds one. Coach "heat" is
  how far results sit below expectation since he was hired. AI teams fire in-season at a weekly
  chance when heat is high, and at the season-end review. For a human team the owner shows a
  card ("the owner wants the coach gone"). Firing pays out his remaining years in cash and
  lifts confidence. Keeping him costs confidence, and more if the slide goes on.
- **AI GMs**: once confidence exists, the bottom-quarter firing rule in `offseason/gms.ts`
  becomes "fired when the owner's confidence is low". The voluntary 15% stays.
- **You**: the owner warns first (a hot-seat card below 30). He fires only at the season-end
  review, below 15, after the honeymoon. Never in the middle of a sim. A fired GM gets a career
  screen: take an offer from a team with a vacancy, or keep watching the league. "Can be
  fired" is a save option, default on.

Owner behaviour numbers (patience effects, confidence steps and thresholds, fan movement,
elasticity) stay as named constants in `sim/finance` and `sim/people`, like `GM_LEAVES`. They
are game feel, not league rules, and none of them is sourced.

## Ruleset data

A new `Ruleset.finance` block (the type in `sim/cba/ruleset.ts`), filled in `NHL_2026` in
`sports/hockey/ruleset-nhl-2026.ts` and inherited by `FICTIONAL_2026`, each value commented with a link to this brief's table. The values are gate
and game-day spend a fan, the yearly sponsorship and local-media base, the league share,
playoff markup, players' share and fee, arena fixed and per-date cost, the capacity range,
coach salary and term, and the market range.

Open for the first job: store dollars, or store fractions of `cap.upperLimit` so a sandbox cap
rescales the economy. Fractions keep "never hard-code a rule number" honest when the cap grows.
Dollars read more easily. Either way the sim reads only `ctx.ruleset.finance`.

Decided in job 2: dollars (the cap does not move inside a ruleset yet). Tuning in the lab also
settled three things the table above leaves open. A fan's ticket and game-day spend, and each home
date's operating cost, scale with market like sponsorship and media do. Market is drawn skewed
(most teams small or mid-market, mean about 1). Operations are $50M a year plus $1.9M a home date
at market 1.

Job 3 tuned the fans: demand is 1.1 x (0.3 + 0.7 x interest / 50) x market^0.2 x price^-1.5 of
capacity; interest pulls 30% a month toward 50 + 150 x (points % - .500), less half a point per
percent of seats left empty, and gains 3 per playoff series. Local media came down to $15M at
market 1 and interest 50 to keep the revenue mean near $300M. Star players and selling them do
not move interest yet. AI teams price +10% (profit-first owner), 0 or -10% (winning-first).

## What the balance lab should measure

Per team-season, over the usual 20 leagues x 20 years, on seeds 1, 101 and 201:

| Check                           | Target                     | From                    |
| ------------------------------- | -------------------------- | ----------------------- |
| Revenue, mean                   | $265M to $320M (2026-27)   | Forbes mean x 1.18      |
| Revenue, top team / bottom team | 2x to 3x                   | Forbes, 2.7x            |
| Operating profit, mean          | $70M to $105M              | Forbes $74M x 1.18      |
| Team-seasons losing money       | 0% to 10%                  | Forbes: none in 2024-25 |
| Gate share of revenue           | 35% to 45%                 | Sportico via THW, 44%   |
| Attendance, % of capacity       | 94% to 99%                 | NHL, 96.9%              |
| Coach changes                   | 0.25 to 0.40 a team-season | The Win Column          |
| Coaches fired in-season         | 0.10 to 0.20 a team-season | ESPN, 0.16              |
| Revenue against points %, r     | report only (unverified)   | none                    |
| Fan interest year-to-year r     | report only (unverified)   | none                    |
| AI GM tenure                    | report only (unverified)   | none                    |

Money must not move the existing checks (spread, turnover, cap legality) until a job means it
to. Paste the lab before and after in every job's PR.

One lever to measure later, not to build now: owner budget as a payroll ceiling for AI teams.
Rich and frugal owners would give the lasting, moving team edge the
[long-run spread brief](2026-11-long-run-spread.md) asks for. Check it against that brief's
benchmarks before turning it on.

## Jobs (one PR each, in order)

1. **Owners and markets.** `OwnerProfile` and `Team.market` in shared, `ownerOf` in
   `sim/people`, fictional owner names, the owner shown on the team page.
   _Done when:_ every team in a new league and in an old save shows an owner (name, priority,
   patience) and a market, and the lab report is identical to main.
2. **Money rules and the ledger.** `Ruleset.finance`, the revenue and cost lines in
   `sim/finance`, a monthly `finance.settled` event, `cash` in state and saves, and lab checks
   for revenue, profit, losses and gate share.
   _Done when:_ those lab checks are in range on seeds 1, 101 and 201, the other checks are
   unchanged, and a test shows a signing bonus paid on day one and a buyout paid in its season.
3. **Fans and ticket pricing.** Fan interest, capacity and attendance, the
   `finance.setTicketPrice` command, AI pricing by owner priority, and attendance and price on
   the team page.
   _Done when:_ attendance is 94-99% in the lab; a test shows +20% on a losing team losing
   seats and gate money; a winning season raises next season's attendance.
4. **Confidence, meetings and cards.** Owner confidence, preseason objectives, the deadline
   check-in and the season-end review as events, the card engine (`owner.cardOpened`,
   `owner.answerCard`, `owner.cardAnswered`) with the first three cards in English and French,
   and owner cards in Home's To do.
   _Done when:_ a three-season test sets and grades objectives every season, each card option
   changes exactly what it says, and AI owners answer without a card.
5. **Owner screen.** The Owner section: the one money-flow chart, objectives, confidence, and a
   history of meetings, built from `ui/` components.
   _Done when:_ the screen reads only from a `GmApi` query, its strings are in `en.ts` and
   `fr.ts`, and it shows a year-20 save inside the speed budget.
6. **Head coach and the hot seat.** `CoachProfile` on `Team` (derived when absent), salary in
   the ledger, coach heat, AI coach firings in-season and in summer, the human owner's
   fire-or-keep card, and news.
   _Done when:_ the lab's coach checks are in range on three seeds, and firing pays his
   remaining years in cash.
7. **Projects and more cards.** Multi-season projects (renovation, fan festival) and the rest
   of the first cards (naming rights, fire sale, spend to the cap).
   _Done when:_ a renovation raises capacity after its build seasons in a test, and the lab
   stays green.
8. **Your job on the line.** Hot-seat warnings, firing at the season-end review, the career
   screen with offers, the "can be fired" save option, and AI GM firing moved from the
   bottom-quarter rule to owner confidence.
   _Done when:_ a test league with a tanking human team is warned and then fired at a review,
   with the option off it is never fired, and AI GM tenure is in the lab report.

After job 8 the event engine's "coach on the hot seat" and "frustrated owner" team events have
what they need, and the front-office headline can give staff budgets and the coach their
effects.
