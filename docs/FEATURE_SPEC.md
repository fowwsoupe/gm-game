# GM Game – Feature Spec (NHL first)

Living copy of the team's feature spec. Phases and status live in [ROADMAP.md](ROADMAP.md).

## Vision and pillars

A sports GM game for Steam where the league feels alive, every decision has a visible consequence, and the AI thinks like a real front office. **NHL, NBA and NFL**, starting with the **NHL only**. Each sport is its own module (game sim, positions, ratings, rules), while features (trades, contracts, free agency, draft, owner layer, news, UI) are shared and work the same way across sports.

1. **A living league.** You always know who is contending, who is in trouble and who just made a move. Trade requests, disputes, injuries and slumps happen to every team, not only yours.
2. **Smart, honest AI.** AI GMs value players per team, understand bad contracts, and explain their decisions. Harder difficulty means smarter AI, never cheating.
3. **Decisions, not spreadsheets.** Cards, choices and clear visuals instead of tables and sliders. Every dollar and every hire shows a measurable effect.
4. **Realism you can feel.** Real CBA rules, non-linear careers, realistic upset rates. Rules calibrated against real NHL data, with machine learning where a fit is needed.
5. **Fast forever.** Sim a day under 0.5 s and any screen under 200 ms, even 20 years into a save.
6. **Yours to shape.** Everything is data: rules, teams, awards, rosters. Sandbox leagues and community roster files.

**Working rule:** when an idea sounds fun but is unrealistic (playoff momentum, two teams in one league), we check it against real data and adjust before building.

## v0.1 Early Access scope

Ship a complete multi-season loop, polished: season, playoffs, draft, re-signing, free agency, next season, for 20+ years without hitting a wall. Fewer features, each one finished.

| Area           | In v0.1                                                                |
| -------------- | ---------------------------------------------------------------------- |
| Season loop    | Full yearly cycle, many seasons                                        |
| Sim            | Line-by-line game sim + fast odds sim, speed targets met               |
| Players        | Hidden ratings, percentile cards, builds, development, generated faces |
| Rules & cap    | Real CBA as data, cap sheet, ELC / RFA / UFA                           |
| Trades v1      | Surplus and negative value, team status, AI explains itself            |
| Draft v1       | Visual board, follow list, floor/ceiling ranges                        |
| Free agency v1 | Player priorities + interest meter                                     |
| Living league  | News feed, league pulse, sim until it matters, playoff odds            |
| Screens        | Home, roster & lines, standings, stats, player profile, team pages     |
| Rosters        | Fictional default league + community roster import                     |

**After launch (update headlines):** owner & finance, front office, live draft trade room, free-agency bidding wars, match viewer, cutscenes, media & press, international tournament, hot-seat and hosted multiplayer, multi-sport.

## Architecture

Seven shared engines live in `packages/sim`; every feature is a thin layer on top of them.

| Engine          | Folder        | Owns                                                       | Features built on it                                                      |
| --------------- | ------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Sim             | `sim/game`    | Line-by-line game sim, fast odds sim, seeded RNG           | Game center, lines & formations, goalie rules, playoff odds, match viewer |
| Players         | `sim/players` | Hidden ratings, percentiles, builds, development, injuries | Player profile, builds & spot fit, training & camp, scouting ranges       |
| Value           | `sim/value`   | Surplus value, pick value, market value, per-team worth    | Trades, draft room, free agency, cap advisor, AI GM decisions             |
| People          | `sim/people`  | Personalities, morale, priorities, GM and owner styles     | Negotiations, FA interest, trade requests, locker room, press             |
| CBA & cap       | `sim/cba`     | Ruleset, cap math, contract rules                          | Cap sheet, contracts, waivers & IR, retention, buyouts                    |
| League & events | `sim/league`  | Calendar, team status, event engine, news                  | League pulse & feed, sim until it matters, power rankings, awards         |
| Owner & finance | `sim/finance` | Revenue, budgets, facilities, objectives                   | Board objectives, staff, business decisions, multi-team empire            |

- **The sim is pure.** No Node, DOM, database or `Math.random()`; enforced by lint. Runs in a worker thread.
- **Everything is data.** Rules, teams, colours, awards, schedule and playoff format live in data, never hard-coded.
- **Every action is a command.** Trades, signings and line changes go through one command layer (`GmApi`). This makes multiplayer possible later.
- **SQL only in `packages/data`.** One save = one SQLite file. Never edit a shipped migration.
- **Models behind interfaces.** Rules-based defaults calibrated against real data; trained models only for stats to ratings and development ([ADR 0005](adr/0005-calibrate-first.md)). The interfaces and table formats (MODEL_CONTRACTS.md) stay so a replacement can be tried in the lab.
- **Seeded everything.** Same seed, same season: reproducible bugs, replayable games, fair multiplayer.

## Foundation: data, models and calibration

Python measures public historical data to set the targets and tuning numbers the rules must hit; two models are trained where a fit is needed (stats to ratings, development); the game ships rules and tables, never player data.

1. **Data pipeline.** Play-by-play with shot locations, player stats, drafts, contracts, junior and European seasons (collect junior/European when suitable rights exist). Community roster files supply players in the shipped game; historical data supports research and calibration.
2. **What drives winning.** Which advanced stats predict goals and wins. Decides which ratings the game needs.
3. **Stats to ratings.** Turns a stat line into hidden ratings so community rosters get rated automatically (trained on the sim's own seasons).
4. **Growth and potential.** Trained on NHL careers: career-shape distributions (peak age, length, decline speed), skill-specific aging, junior/European translation, potential as a floor/ceiling range.
5. **Value.** Player surplus value, draft-pick value curve, contract demands, checked against published trade and signing anchors.

Calibrated in the game: shot quality, scoring and save levels, injury rates (Sim); aging and career shapes (Players); player value, contract demands, team strategy, trade acceptance (AI GMs), all as readable rules.

Rules: seeded; every AI decision shows a readable reason; every tuning change is checked in the balance lab with a fixed seed; check each data source's terms of use.

## Living league

- **League pulse:** every team tagged contender, buyer, bubble, seller, rebuilder or in crisis, re-checked through the season.
- **League-wide feed:** every trade, signing, injury, firing, dispute and streak, not just your team.
- **Event engine:** runs every sim day. Player events (trade requests, holdouts, disputes, slumps, breakouts) and team events (coach on the hot seat, frustrated owner, fire sales), with choices and consequences.
- **Sim until it matters:** the sim stops itself on important events, with a filter you control.
- **Personalities** drive morale, contract asks, trade requests and FA priorities. One system used everywhere.
- **Rival AI GMs** with styles: rebuild, win-now, analytics, old-school. **Owner pressure:** the GM can be fired.
- **Chemistry: clear, fixable, capped.** Visible with reasons; built from time together, fitting builds and handedness, personalities and leadership; worth a few percent at most; real-life linemates start with chemistry.
- **Media & press (text, not cutscenes):** question cards only after big moments; answers move morale, fans, owner, rivals; your quotes become headlines.

## Core screens

Five top sections: Home, Team, League, Front Office, Owner. Cmd+K search and keyboard shortcuts.

- **Home:** one screen, never scrolls. Top strip (record, place, playoff odds, cap space, next game); upcoming games; To do (offers, expiring deals, injuries, lineup gaps, owner requests; clears to zero); top 3 headlines; sim bar (day, to next decision, to date).
- **Roster & lines:** drag-and-drop on a rink view; PP (1-3-1, umbrella, overload) and PK (box, diamond) formations by spot; line tactics and ice time; coach philosophy fit; goalie rules (2/3, 50/50, starter except back-to-backs); auto-lines with locks.
- **Schedule & game center:** full box score with every stat incl. advanced, three stars, shot map, recap.
- **Standings:** daily playoff odds, race-night insights (odds after a win or loss), odds chart, power rankings, top moves graded.
- **Stats & leaders:** time slices, hot/cold vs each player's own baseline, advanced and per-60, line and pair rankings, goalie board, compare.
- **Player profile:** bio, percentiles, build, potential range, personality; career stats at every level; advanced stats; full contract (AAV, salary by year, bonuses, status at expiry, trade protection list); history log.
- **Team pages:** roster, cap sheet, depth chart, strategy, analytics for all 32 teams.

## Player identity, development and injuries

No overall rating; the sim runs on hidden ratings underneath.

- **Percentile cards**, **builds**, **role tags**, **traits**, **spot fit** (from shot locations and handedness), **generated faces** that age with the player.
- **Development is never a straight line:** each career has its own shape; good and bad seasons around the trend; skills age at different speeds; training plans work within each skill's hidden ceiling.
- **Injuries:** cleared is not 100%; injury history and re-injury risk; injuries hit specific skills; you manage the return and medical staff changes the odds.

## GM systems

### Trades

- Value per team, not one number. Surplus value can go negative.
- Pick value from the team's projected finish, class strength, vs all other teams.
- Team status drives the AI. Deadline rentals discounted. Leverage from trade requests, NMC/NTC, cap trouble.
- Position scarcity from supply and demand (right-shot D cost more; goalies discounted).
- No quantity-for-quality exploit.
- Trade block (players and picks), conditional picks, retained salary (max 50%, three contracts, no double retention), future considerations, three-team trades.
- AI explains itself; checked against published trade anchors.

### Contracts and cap

- Market value; real salary by year + AAV; signing and performance bonuses.
- ELC by age, RFA (offer sheets, arbitration), UFA, PTO, two-way.
- Trade protection; buyouts (2/3 or 1/3 by age, twice the remaining term); extensions; 10% over in the offseason.
- CBA as data, current rules by default (playoff cap, no double retention, 7/6-year max terms, front-loading limits, 84 games).
- Cap sheet with projection, allocation, what-if; cap advisor and ripple effects (warns, never blocks).
- Negotiation by personality and agents (design later).

### Free agency

- Priorities (money, winning, role, loyalty, mentor, home, term) weighted by personality and age.
- Interest meter with reasons; loyalty and hometown discounts; live bidding war; pitch your team; decisions take days.

### Draft and prospects

- Scouting quality narrows ranges; visual draft board in tiers; smart insight; follow list of ~20 with scout reports; prospect stories.
- Live draft trade room with a clock; AI teams trade too. Track picks after the draft.

## Season loop

Summer training → camp → preseason → 84-game season → deadline → playoffs → awards → draft → re-signings → free agency.

- Summer training plans, camp battles, preseason; fictional international tournament every four years; offseason stories.
- **Playoffs:** momentum kept honest (goalie form + small confidence effect, calibrated to real upset rates); injuries and fatigue; playoff cap; storylines; own cup + Playoff MVP.
- **Awards & history:** everything tracked; record book and record watch; Hall of Fame; legends return as staff; own award names (League MVP, Best Defenceman, Best Goaltender, Rookie of the Year, Playoff MVP...), renameable after in-game legends.

## Owner layer

- **Front office:** assistant GM, scouting, analytics (blurrier numbers when weak), medical, coaching staff, development, staff market; every department reports its return; diminishing returns.
- **Finances:** revenue follows winning; business decision cards; pricing as a policy; fans as a living crowd; projects over seasons; owner meetings; one money-flow chart.
- **GM career:** trophy case, career record, reputation.
- **Multi-sport empire:** one team per league; earn the right to bid; buying takes months; sell for profit; shared money, staff and reputation; empire dashboard; hire GMs.

## League setup, rosters and licensing

- Fictional default league; community roster JSON (versioned, validated); Steam Workshop; light sims for minor/junior/European leagues.
- Sandbox: rules, any number of leagues, expansion, relocation, identity editor, commissioner mode.
- Licensing (not legal advice): ship fictional names and our own award/trophy names; real-name files must genuinely come from the community; historical data stays private and only sets targets; consult a lawyer before selling.

## Presentation and performance

| Action            | Target                           |
| ----------------- | -------------------------------- |
| Sim one day       | under 0.5 s                      |
| Sim a full season | under 20 s                       |
| Open any screen   | under 200 ms                     |
| Any animation     | under 200 ms, never blocks input |

- Worker-thread sim, incremental stats, replay instead of store, archived old seasons, preloading, virtualized lists, CI speed test.
- Look & feel: broadcast style, team-colour theming, cards before tables, one visual language (colour-blind safe), satisfying short moments, design system first, translation-ready.
- Match viewer (2D): rink with player discs and puck trail, 1–20x, overlays, coach from the bench; animates sim events, no physics sim.
- Cutscenes: short skippable 2D moments (Rive). Press conferences stay text.

## Multiplayer

| Step                        | How it works                                           | Cost to us                   |
| --------------------------- | ------------------------------------------------------ | ---------------------------- |
| 1. Shared save (hot-seat)   | Several people run teams in one league on one computer | Nearly free                  |
| 2. Hosted online league     | One player's game hosts; friends join over Steam       | No servers                   |
| 3. Always-on online leagues | Our servers, accounts, anti-cheat                      | Ongoing; only if players ask |

Framework: every action is a command; the host validates and sims; seeded sim; 1 to 32 humans per league.

## Open questions

See the "Open decisions" list in [ROADMAP.md](ROADMAP.md).
