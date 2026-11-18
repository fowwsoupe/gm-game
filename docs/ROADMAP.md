# Roadmap

**What** the game will have and **where each part stands.** The order we build in, who
owns what and the job queue live in [PLAN.md](PLAN.md). Feature detail:
[FEATURE_SPEC.md](FEATURE_SPEC.md). Architecture rules: [ARCHITECTURE.md](ARCHITECTURE.md).

**First public release:** the full NHL game, Phase 1 and Phase 2 together. That means a
complete multi-season loop, polished (season, playoffs, draft, re-signing, free agency, next
season, for 20+ years without hitting a wall), plus the owner and finance layer, front office,
live draft and free-agency rooms, media, match viewer, cutscenes, sandbox and multiplayer.
Phase 3 (NBA, NFL) comes after release. Fewer features, each one finished.

**Engine first** ([ADR 0005](adr/0005-engine-first-ml-for-calibration.md)): the rules-based
engines are the game. Machine learning measures real NHL data to calibrate them; it is not
a step any feature waits on.

Status: `[ ]` not started · `[~]` in progress · `[x]` done. Last checked 2026-11-18.

Update this file in the PR that changes a status.

---

## Phase 0: Foundation (done)

- [x] Monorepo, CI, Electron app shell, pure sim package, SQLite saves
- [x] Engine structure in `packages/sim` with lint-enforced boundaries
- [x] Multi-sport structure: shared engines + `SportModule` per sport (hockey only for now)
- [x] Model plug-in points (`Models`): goal, development, valuation, contract demand
- [x] CBA ruleset as data (`sim/cba`): cap, contract rules, 84-game season
- [x] Data pipeline (`ml/`): NHL play-by-play and player seasons; junior/European, draft and
      contract data deferred (community rosters instead)
- [x] NHL-only study ([report](research/2026-11-m1-moneypuck-study.md)); rating list v2
      ([RATINGS.md](RATINGS.md)); faceoff effect measured and calibrated
- [x] Hidden ratings + stats-to-ratings v1 (`ratingsFromStats`, fitted on the sim by
      `pnpm ratings:fit`, with uncertainty)
- [x] Line-by-line game sim (`sports/hockey/game.ts`) + "result only" mode; `GoalModel`
      accepts an xG table
- [x] Balance lab (`pnpm lab`): multi-year league-health checks against real NHL seasons
- [x] Speed budgets in CI (day, season, year-20, year-20 screen data)
- [x] Design system: tokens, team theming, Card, Button, PercentileBar, PlayerCard,
      BroadcastCaption
- [x] Command layer + event log + single reducer (multiplayer-ready)
- [x] Translation-ready text (English + French)

## Phase 1: the full loop (v0.1 scope)

**Engines**

- [~] Players (`sim/players`): percentiles, builds and role tags, injuries, injury history,
  re-injury risk done. To do: player traits; potential range on the profile.
- [x] Value (`sim/value`): per-team surplus value (can be negative), market value, pick value
      curve by projected slot
- [x] People (`sim/people`): personalities, free-agent priorities, AI GM styles and skill,
      team plans, morale
- [~] League & events (`sim/league`): calendar, team status (league pulse), news feed, playoff
  odds, trade requests and holdouts with a choice done. To do: a general event engine
  with choices; hot seat (needs an owner and coach, Phase 2).
- [ ] Minor / junior / European leagues: light stats-only sim for prospects (needs a design)

**Features**

- [~] Season calendar: 84 games (divisions, conferences, back-to-backs) → playoffs → awards →
  draft → re-sign → free agency done. To do: training camp; a trade deadline that matters.
- [~] Trades: surplus value per team, anti-quantity, cap and position checks, AI explains
  itself, AI-to-AI trades, retained salary, draft picks (three drafts), AI pays with
  picks, trade block, top-N protected picks done. To do: other conditional picks.
- [~] Contracts & cap: CBA checks, buyouts, cap sheet and advisor, re-signing, extensions, RFA
  rights and offer sheets with compensation picks, signing bonuses, no-trade clauses,
  performance bonuses done. To do: a waiver flow for no-trade players; 35+ contracts;
  the 23-player roster maximum (needs prospects off the roster).
- [~] Free agency: summer window, interest meter (money, winning, role, term by age),
  personalities, AI offers and re-signing, loyalty and hometown pulls done. The live
  bidding war is Phase 2.
- [~] Draft: class with scouted potential ranges, your ranked board, scout reports, lottery
  before the draft so picks trade at their real slot done. The live draft room is Phase 2.
- [x] Playoffs: bracket, NHL-style wild cards, goalie form, Playoff MVP, playoff cap
- [x] Awards, records, history
- [~] Living league: named feed, league pulse, playoff odds and power rating, sim until it
  matters, race nights, streak and slump news, trade requests with a talk, holdouts for
  your team done. To do: AI-team holdouts (after a balance pass); hot seat (Phase 2).
- [~] Chemistry: time together, locker room (leaders, toxic players), builds fit and
  linemates done. To do: balance once the long-run edge is fixed.

**Screens**

- [x] Home hub: top strip, To do, news, playoffs, sim-to-date bar
- [x] Roster & lines: roster with player cards, Lines with drag and drop, PP/PK units, goalie
      rotation rule
- [x] Player profile (own screen, career totals, awards, moves), leaders, standings, team
      pages, game center, cap, trades, draft, free agency, history, Cmd+K, first-run walkthrough
- [~] Generated faces: aging SVG faces on the player card, roster, trade and draft tables.
  To do: leaders and news.

**Balance**

- [~] Long-run team edge: simulated leagues flatten over many seasons (good teams don't stay
  good long enough). Brief: [research/2026-11-long-run-spread.md](research/2026-11-long-run-spread.md).
- [~] Careers look real over 20 seasons (peaks, declines, busts, late bloomers at real rates):
  engine done; calibrate against real NHL career data.

**Rosters**

- [x] Fictional default league
- [~] Community roster import (versioned JSON, validated) works. To do: Steam Workshop.

## Phase 2: part of the first release (one headline each)

- [ ] Owner & finance: decision cards, pricing policy, fans, projects, owner meetings
      (`sim/finance` is a stub today)
- [ ] Front office: scouting, analytics, medical, coaching, development staff
- [ ] Live draft room with trades
- [ ] Free-agency live bidding war + full contract negotiation
- [ ] Media & press conferences (text)
- [ ] Match viewer (2D) + coach from the bench
- [ ] Cutscenes (trophy lift, draft pick, signing)
- [ ] Summer training, camp battles, international tournament
- [~] Hall of Fame (done), legends return as staff, awards named after legends
- [ ] League sandbox: expansion, relocation, identity editor, commissioner mode
- [ ] Multiplayer step 1: shared save (hot seat)
- [ ] Multiplayer step 2: hosted online league over Steam

## Release prep

- [ ] Partnership agreement (ownership, revenue split)
- [ ] Incorporate and see a lawyer before any revenue (licensing, Quebec image rights)
- [ ] Steam store page up early for wishlists; Steamworks build; a few achievements
- [ ] Closed playtest with friends; fix the top issues
- [ ] Price, Early Access description, public post-launch roadmap; demo (Next Fest)

## Phase 3: after release

- [ ] NBA, then NFL, on the same engines
- [ ] Multi-sport ownership empire
- [ ] Always-on online leagues (only if players ask)

---

## Open decisions

Research behind these: [research/2026-11-sports-gm-research.md](research/2026-11-sports-gm-research.md).

- [ ] **Data rights (blocker before launch):** NHL API and MoneyPuck are non-commercial;
      Hockey-Reference and Elite Prospects ban model training. With engine-first, the game
      ships derived numbers rather than trained models, which is a smaller ask; still get
      written permission or use cleared sources. Tracker: [DATA_RIGHTS.md](DATA_RIGHTS.md).
- [ ] **Ship a fully fictional league;** never host real-player or logo files.
- [ ] Pricing: research suggests $19.99 in Early Access, $24.99-29.99 at 1.0.
- [ ] Phase 2 build order beyond owner & finance, and who owns which headline
- [ ] Game name and championship cup name
- [ ] Contract negotiation design
- [ ] Steam launch plan: Early Access timing, price, demo, roadmap page
