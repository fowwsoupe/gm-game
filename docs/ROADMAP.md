# Roadmap

First roadmap for the GM game (NHL first). Full feature detail lives in
[FEATURE_SPEC.md](FEATURE_SPEC.md); architecture rules in [ARCHITECTURE.md](ARCHITECTURE.md).

**Goal of the first public release:** the full NHL game, Phase 1 and Phase 2 together: a
complete multi-season loop, polished (season, playoffs, draft, re-signing, free agency, next
season, for 20+ years without hitting a wall), plus the owner and finance layer, front office,
live draft and free-agency rooms, media, match viewer, cutscenes, sandbox and multiplayer.
Phase 3 (NBA, NFL) stays after release. Fewer features, each one finished.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

## Next up (in order)

Ready jobs, each one PR. Pick from the top. Update this list in the PR that finishes a job.

Ready now (code can start):

1. Draft-room trades: the lottery is now drawn when the champion is crowned and round-one picks trade at their real slot (done); trading during the live draft stays with the Phase 2 draft room.
2. Contract bonuses and trade protection: done. Signing bonuses (CBA-capped share of the cap hit, liked by the player, never bought out) and no-trade clauses (ruleset age and per-team limit, trades refuse them). Performance bonuses done (first-round entry deals, paid at season end, overage on next season's cap). A waiver flow for no-trade stays open.
3. Holdouts: done (opening day, greed and pay decide; a talk or the weeks end it). AI teams' core players hold out at half the human-team chance (about 4 a league-season); a win-now GM, or a good balanced one, extends him once his deal is in its last year and the raise fits next season's cap; a builder waits him out. AI GMs trading a holdout stays open.
4. Chemistry: personalities and leaders done (two settled leaders make the room whole; hot-headed, unprofessional players wear on it; lab flat). Builds fit done (a finisher with a creator on a line, an offensive with a home defenceman on a pair; mean-neutral, lab flat). Linemates done (games together by pair in the save; a line and pair that have played 20 games together gain up to a point, strangers lose one).
5. Re-injury risk: done (hurt earlier this season +30%, +3% per past injury, capped at 2x; injuries per team-season 7.9-8.1 to 8.2-8.5).
6. Player profile screen of its own and more face variety: done (open it from Leaders or the roster card).

Needs a design first (a short brief in `docs/research/`, then jobs):

- **A lasting team edge** (long-run flattening): [research/2026-11-long-run-spread.md](research/2026-11-long-run-spread.md) is the brief.
- Minor / junior leagues; camp and a trade deadline that matters; player traits and clustered builds.
- Every other Phase 2 headline below. Owner and finance is done (all eight jobs of
  [research/2026-11-owner-finance.md](research/2026-11-owner-finance.md)): the event engine's
  hot-seat and frustrated-owner team events, and the front office (staff budgets, the coach's
  effect on games), can now attach to an owner and a coach.

---

## Phase 0 — Foundation (now)

Builds the engines everything else depends on.

- [x] Monorepo, CI, Electron app shell, pure sim package, SQLite saves
- [x] Engine structure in `packages/sim` with lint-enforced boundaries
- [x] Multi-sport structure: shared engines + `SportModule` per sport (hockey only for now)
- [x] Model plug-in points (`Models`): goal, development, valuation
- [x] CBA ruleset as data (`sim/cba`): cap, contract rules, 84-game season
- [x] Data pipeline (`ml/`): NHL play-by-play and player seasons prototyped; junior/European, draft and contract inputs deferred past v0.1 (community rosters instead)
- [x] NHL-only held-out study done ([report](M1_PROTOTYPE_REPORT.md)); rating list v2 in code ([RATINGS.md](RATINGS.md)); `faceoffs` effect measured and calibrated (`ml/src/faceoffs.py`); M1 signed off on the NHL-only prototype
- [x] Hidden ratings (list v2) + stats-to-ratings model v1 (`ratingsFromStats`, fitted on the sim by `pnpm ratings:fit`, with uncertainty); roster import does not use it yet (M4)
- [x] Line-by-line game sim (`sports/hockey/game.ts`) + "result only" mode; trained shot model (Azmi) plugs into `GoalModel` as a `gm-xg-table`
- [x] Balance lab: league-health report (`pnpm lab`) with multi-year checks (talent drift, dynasties, cap, playoff turnover, goalie save % repeatability, faceoff effect, goals vs expected, points % spread and repeatability against real NHL seasons); green apart from the long-run known gaps it lists ([why](research/2026-11-long-run-spread.md))
- [x] Speed test in CI: day, season and year-20 budgets, plus year-20 screen data (standings, leaders, cap sheet)
- [x] Design system: tokens, team theming, Card, Button, PercentileBar, PlayerCard, BroadcastCaption
- [x] Command layer + event log + single reducer (multiplayer-ready)
- [x] Translation-ready text (English + French)

## Phase 1 — v0.1 Early Access (the full loop)

Build order, owners and "done when" for each step: **[V0.1_PLAN.md](V0.1_PLAN.md)** (milestones M1–M9).

**Engines**

- [~] Players (`sim/players`): percentiles, builds and role tags (rules), injuries and injury history (shown on the player card) done; re-injury risk done; traits, clustered builds to do
- [x] Value (`sim/value`): per-team surplus value (can be negative), market value, pick value curve (rules-based; calibrated curve is Azmi's)
- [x] People (`sim/people`): personalities (from the player id), free-agent priorities by age and personality, AI GM styles and skill, team plans, morale (shown on the player card; no effects yet) done
- [ ] League & events (`sim/league`): calendar, team status (league pulse), event engine, news
- [ ] Minor / junior / European leagues: light stats-only sim for prospects

**Features**

- [~] Full season calendar: 84 games (divisions, conferences, back-to-backs) → playoffs → awards → draft → re-sign → FA done; camp and a trade deadline that matters wait for trades (M6)
- [~] Trades v1: surplus value per team (status, rentals, negative contracts), anti-quantity, cap and position checks, AI explains itself, trade screen, AI-to-AI trades (both GMs must accept), retained salary, draft picks (next three drafts, value curve by projected slot) done, AI GMs pay with picks, trade block (listed players draw more AI offers), top-N protected picks done
- [~] Contracts & cap: CBA checks, buyouts, cap sheet screen, cap advisor, offseason re-signing and in-season extensions, RFA rights with offer sheets the rights team can match, and compensation picks when it does not (NHL-style tiers by cap hit), done; signing bonuses, no-trade clauses and performance bonuses (overage carries to next season's cap) done
- [~] Free agency v1: free-agency window in the summer, offers with an interest meter (money, winning, role, term weighted by age), signings any time outside the playoffs, personalities (greed, ambition), AI offers, AI re-signing by loyalty and ambition, and loyalty (to his old team) and hometown pulls on the interest meter done
- [~] Draft v1: class announced after the playoffs with scouted potential ranges (AI sees the same ranges), your ranked list drives your picks, scout reports (best and weakest skills, ready or raw) done; lottery drawn before the draft so picks trade at their real slot done; the live draft room is Phase 2
- [x] Playoffs: bracket, NHL-style wild cards, honest momentum (per-game goalie form, calibrated), Playoff MVP, playoff cap; the cup is "Champion" until it is named
- [x] Awards, records, history (own award names, Playoff MVP included)
- [~] Living league: feed with names (trades, signings, extensions, long injuries, first pick), league pulse, playoff odds and power rating, sim until it matters (your team and league-wide moments only), race nights (odds if you win or lose the next game), streak news, trade requests with a talk (personality decides), slump news (a top-6 skater 10 games without a point), holdouts (underpaid, greedy core players; AI GMs extend or wait them out), the hot seat (coaches fired in-season and at the review; your owner warns you, then fires you at a review, and teams with a vacancy offer you a job) done
- [~] Chemistry: v1 from time together (visible on Lines, changes with every move, capped at ±1 rating point per unit) done; locker room (leaders and toxic personalities), builds fit and linemates done

**Screens**

- [~] Home hub: top strip (record, place, playoff odds, cap space, next game), To do that clears to zero, news, playoffs done (with a sim-to-date bar)
- [~] Roster & lines: roster screen with stats and player cards, Lines screen (your depth order sets lines, pairs and the starting goalie, used every game), drag-and-drop, PP/PK units and a goalie rotation rule (backup on back-to-backs, starter always but tired, or split) done
- [~] Player profile, stats & leaders, standings, team pages, game center: percentile player card, leaders, standings, game center done; career stats with totals, awards and moves history on the card, and a profile screen of its own, done
- [~] Generated faces: deterministic SVG face per player that greys and lines with age, on the player card; more variety (hair, facial hair, eyes, ears, scars) done; also on the roster, trade, draft, leaders and news-feed rows

**Rosters**

- [x] Fictional default league
- [~] Community roster import (versioned JSON, validated) works; Steam Workshop remains for release prep

**Before launch**

- [ ] Partnership agreement (ownership, revenue split)
- [ ] Legal consult (licensing, company)
- [ ] Steam store page up early for wishlists; price; demo (Next Fest)

## Phase 2 — Part of the first release (one headline each)

- [x] Owner & finance: decision cards, pricing policy, fans, projects, owner meetings; owners and markets, the money ledger, fans and ticket pricing, confidence, meetings and cards, the Owner screen, projects and more cards, the head coach (salary, heat, AI firings in-season and at the review, the fire-or-keep card), and your job on the line (hot-seat warning, fired at a review, job offers, a "can be fired" option, AI GMs fired on confidence) (all 8 jobs in [the brief](research/2026-11-owner-finance.md))
- [ ] Front office: scouting, analytics, medical, coaching, development staff
- [ ] Live draft trade room
- [ ] Free-agency live bidding war + full contract negotiation
- [ ] Media & press conferences (text)
- [ ] Match viewer (2D) + coach from the bench
- [ ] Cutscenes (trophy lift, draft pick, signing)
- [ ] Summer training, camp battles, international tournament
- [~] Hall of Fame, legends return as staff, awards named after legends: Hall of Fame (rule-based induction, History screen) done; the rest to do
- [ ] League sandbox: expansion, relocation, identity editor, commissioner mode
- [ ] Multiplayer step 1: shared save (hot-seat)
- [ ] Multiplayer step 2: hosted online league over Steam

## Phase 3 — Long term

- [ ] NBA, then NFL, on the same engines
- [ ] Multi-sport ownership empire
- [ ] Always-on online leagues (only if players ask)

---

## Open decisions

Research behind these: [docs/research/2026-11-sports-gm-research.md](research/2026-11-sports-gm-research.md).

- [ ] **Data licensing (blocker before launch):** NHL API and MoneyPuck are non-commercial;
      Hockey-Reference and Elite Prospects ban model training. Prototype freely; before launch,
      ask the NHL and MoneyPuck for commercial permission or license a commercial feed.
- [ ] **Incorporate and see a lawyer before any revenue** (Quebec image rights are strict;
      ship a fully fictional league; never host real-player or logo files).
- [ ] Pricing: research suggests $19.99 in Early Access, $24.99-29.99 at 1.0.

- [ ] Build order and who owns which engine
- [ ] Game name and championship cup name
- [ ] Contract negotiation design
- [ ] Steam launch plan: Early Access timing, price, demo, roadmap page
