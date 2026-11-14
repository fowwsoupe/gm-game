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
- [ ] Data pipeline (`ml/`): play-by-play, stats, drafts, contracts, junior + European seasons
- [ ] Study: which advanced stats drive goals and wins → final rating list
- [ ] Hidden ratings model + stats-to-ratings model
- [ ] Line-by-line game sim (`sim/game`) + fast "result only" odds sim
- [~] Balance lab: league-health report works (`pnpm lab`); multi-year checks once seasons roll over
- [~] Speed test in CI: day and season budgets in place; year-20 save and screen timing to add
- [~] Design system: tokens, team theming, Card, Button, PercentileBar; player card and broadcast captions to add
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

- [ ] Full season calendar: camp → 84 games → deadline → playoffs → awards → draft → re-sign → FA
- [ ] Trades v1: team status, rentals, leverage, scarcity, trade block, conditional picks, retention, AI explains
- [ ] Contracts & cap: ELC / RFA / UFA, bonuses, buyouts, trade protection, cap sheet + projection, cap advisor
- [ ] Free agency v1: player priorities + interest meter
- [ ] Draft v1: visual board, follow list, floor/ceiling ranges, scout reports
- [ ] Playoffs: honest momentum (goalie form), own cup + Playoff MVP, playoff cap
- [ ] Awards, records, history (own award names)
- [ ] Living league: feed, league pulse, sim until it matters, playoff odds + race nights
- [ ] Chemistry: visible, changeable, capped

**Screens**

- [ ] Home hub (one screen, To do clears to zero, sim bar)
- [ ] Roster & lines (drag-and-drop, PP/PK formations, goalie rules)
- [ ] Player profile, stats & leaders, standings, team pages, game center
- [ ] Generated faces

**Rosters**

- [ ] Fictional default league
- [ ] Community roster import (versioned JSON, validated) + Steam Workshop

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

- [ ] Build order and who owns which engine
- [ ] Game name and championship cup name
- [ ] Contract negotiation design
- [ ] Steam launch plan: Early Access timing, price, demo, roadmap page
