# Roadmap

First roadmap for the GM game (NHL first). Full feature detail lives in
[FEATURE_SPEC.md](FEATURE_SPEC.md); architecture rules in [ARCHITECTURE.md](ARCHITECTURE.md).

**Goal of v0.1 (Early Access):** a complete multi-season loop, polished. Season, playoffs,
draft, re-signing, free agency, next season, for 20+ years without hitting a wall.
Fewer features, each one finished.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

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
- [x] Balance lab: league-health report (`pnpm lab`) with multi-year checks (talent drift, dynasties, cap, playoff turnover, goalie save % repeatability, faceoff effect, goals vs expected); green except "better team wins a best-of-7", about half a point under its floor since goalie form
- [x] Speed test in CI: day, season and year-20 budgets, plus year-20 screen data (standings, leaders, cap sheet)
- [x] Design system: tokens, team theming, Card, Button, PercentileBar, PlayerCard, BroadcastCaption
- [x] Command layer + event log + single reducer (multiplayer-ready)
- [x] Translation-ready text (English + French)

## Phase 1 — v0.1 Early Access (the full loop)

Build order, owners and "done when" for each step: **[V0.1_PLAN.md](V0.1_PLAN.md)** (milestones M1–M9).

**Engines**

- [ ] Players (`sim/players`): percentiles, builds, role tags, traits, non-linear development, injuries
- [ ] Value (`sim/value`): per-team surplus value (can be negative), pick value curve, market value
- [ ] People (`sim/people`): personalities, morale, player priorities, AI GM styles
- [ ] League & events (`sim/league`): calendar, team status (league pulse), event engine, news
- [ ] Minor / junior / European leagues: light stats-only sim for prospects

**Features**

- [~] Full season calendar: 84 games (divisions, conferences, back-to-backs) → playoffs → awards → draft → re-sign → FA done; camp and a trade deadline that matters wait for trades (M6)
- [ ] Trades v1: team status, rentals, leverage, scarcity, trade block, conditional picks, retention, AI explains
- [~] Contracts & cap: CBA checks, buyouts, cap sheet screen, cap advisor and offseason re-signing done; RFA / UFA, bonuses, trade protection, in-season extensions to do
- [ ] Free agency v1: player priorities + interest meter
- [ ] Draft v1: visual board, follow list, floor/ceiling ranges, scout reports
- [x] Playoffs: bracket, NHL-style wild cards, honest momentum (per-game goalie form, calibrated), Playoff MVP, playoff cap; the cup is "Champion" until it is named
- [x] Awards, records, history (own award names, Playoff MVP included)
- [ ] Living league: feed, league pulse, sim until it matters, playoff odds + race nights
- [ ] Chemistry: visible, changeable, capped

**Screens**

- [ ] Home hub (one screen, To do clears to zero, sim bar)
- [~] Roster & lines: roster screen with stats and player cards done; drag-and-drop lines, PP/PK formations, goalie rules to do
- [~] Player profile, stats & leaders, standings, team pages, game center: percentile player card, leaders, standings, game center done; full profile (career stats, history) to do
- [ ] Generated faces

**Rosters**

- [x] Fictional default league
- [~] Community roster import (versioned JSON, validated) works; Steam Workshop remains for release prep

**Before launch**

- [ ] Partnership agreement (ownership, revenue split)
- [ ] Legal consult (licensing, company)
- [ ] Steam store page up early for wishlists; price; demo (Next Fest)

## Phase 2 — Post-launch updates (one headline each)

- [ ] Owner & finance: decision cards, pricing policy, fans, projects, owner meetings
- [ ] Front office: scouting, analytics, medical, coaching, development staff
- [ ] Live draft trade room
- [ ] Free-agency live bidding war + full contract negotiation
- [ ] Media & press conferences (text)
- [ ] Match viewer (2D) + coach from the bench
- [ ] Cutscenes (trophy lift, draft pick, signing)
- [ ] Summer training, camp battles, international tournament
- [ ] Hall of Fame, legends return as staff, awards named after legends
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
