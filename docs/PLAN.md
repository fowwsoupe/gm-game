# Plan

**How** we get to the first release: who owns what, the job queue, and each milestone's
"done when". What the game will have and the status of every feature:
[ROADMAP.md](ROADMAP.md). Update both in the PR that finishes a job.

---

## How we work

**Engine first** ([ADR 0005](adr/0005-engine-first-ml-for-calibration.md)). The rules-based
engines in `packages/sim` are the game. Machine learning in `ml/` measures real NHL data and
turns it into lab targets and tuning numbers. No feature waits on a trained model.

**Who does what.**

- **Minh:** sim engines, app, UI, saves, architecture.
- **Azmi:** data and calibration (`ml/`, `tools/balance-lab` ranges): measure real NHL
  targets, fit engine numbers to them, write a short study in `docs/research/` for each
  number that changes. Optional: a model table behind a `Models` interface, if it beats the
  engine in the lab and the AI can still explain itself
  ([MODEL_CONTRACTS.md](MODEL_CONTRACTS.md)).
- The contract between the two is a lab check, a ruleset value or an interface in
  `packages/sim`. Agree on it first in its own small PR, then both build against it.

**Done means** merged, `pnpm check` green, checked in the balance lab (`pnpm lab`, before and
after) where it touches sim numbers, and visible in the app, even if the screen is plain.

---

## Next up

One PR per job. Pick from the top.

**Ready now**

1. **Hockey state out of the shared core.** `LeagueState` holds `goalieRotation`,
   `specialUnits` and `depthCharts`, and shared `commands.ts` / `league/playoffs.ts` know
   about goalies and lines. That breaks [ADR 0004](adr/0004-multi-sport-modules.md). Give
   the state a sport-owned slice that `SportModule` defines, and route the sport's commands
   and events through the module. Do it before more hockey fields land.
2. Faces on the Leaders screen and in the news feed.
3. Potential range on the player profile.
4. Waiver flow for no-trade players.
5. **Split the big switches by engine** as you next touch them: `applyEvent` (40 cases),
   `SaveFile.persist` (45), `handleCommand` (19 in one 500-line file). Each engine owns its
   reducer and persist cases; core combines them.

**Needs a design first** (a short brief in `docs/research/`, then jobs here)

- **Long-run team edge:** the brief is written
  ([research/2026-11-long-run-spread.md](research/2026-11-long-run-spread.md)); cut it into
  jobs. Top balance issue: no model will fix it later, so it is an engine and tuning job.
- **Owner & finance:** first Phase 2 headline. Hot seat and frustrated-owner events need an
  owner and a coach to attach to. `sim/finance` is a stub.
- Training camp and a trade deadline that matters.
- Player traits; minor / junior / European leagues.

**Calibration (Azmi)**

- Real NHL career shapes (peak age, decline speed, bust and late-bloomer rates) → lab ranges
  for development (closes the M4 check).
- Pick value and contract levels against real trades and signings → tune `pickValue` and
  `marketSalary` (closes the M6 calibration).
- Long-run spread targets for the team-edge work (with Minh).
- Optional: a trained xG table for `GoalModel` (`pnpm lab --xg <file>`).

---

## Phase 1 milestones (the full loop)

Status as of 2026-11-18.

### M1: Ratings and data contract (done)

Decide what a player _is_ before building on it. **Done when:** the rating list is agreed and
documented; a roster file loads into a playable league.

Done: rating list v2 ([RATINGS.md](RATINGS.md), adds `faceoffs`, calibrated on its measured
effect), roster import (`rosters/fictional-template.json`), NHL-only study
([report](research/2026-11-m1-moneypuck-study.md)). Junior/European, draft and contract
data are deferred: the game ships community rosters, so real-player data only tests rating
choices. Data rights: [DATA_RIGHTS.md](DATA_RIGHTS.md).

### M2: Game sim, line by line (done)

**Done when:** a season's player and team stat lines look like a real NHL season; the lab is
green over 100 seasons; sim speed stays in budget.

Done (`sports/hockey/game.ts`): shift-by-shift play, PP/PK units, penalties, score effects,
pulled goalie, 3v3 OT and shootout (sudden death in the playoffs), in-game injuries, backup
goalie on back-to-backs. Goals come from shots. `resultOnly` plays the same game without the
box score. `GoalModel` contract: `shotXg({ x, y, shooting, power })`, see
[MODEL_CONTRACTS.md](MODEL_CONTRACTS.md). Known: "better team wins a best-of-7" sits about
half a point under its 60% floor (within one standard error). Not modelled: majors and
fights, rebounds, blocked and missed shots.

### M3: Full season loop (done)

**Done when:** one league plays 20 seasons with no crash or dead end; the lab's multi-year
checks pass (talent stable, no runaway dynasties, sane cap use).

Done: schedule with divisions, conferences and back-to-backs; playoffs with wild cards and
the playoff cap; goalie form (`ml/src/form.py`); awards and records; the whole offseason.
Camp and the trade deadline moved to Next up.

### M4: Players, identity and development (engine done; calibration open)

**Done when:** careers look realistic over 20 simulated years (peaks, declines, busts and
late bloomers at real rates); the profile shows percentiles, build and career stats.

Done: percentile cards, builds and role tags (`sports/hockey/builds.ts`, behind
`SportModule.role`), personalities, aging faces, career stats per season, injury history,
re-injury risk, own profile screen, Hall of Fame. Development is the rules-based engine
(`rulesDevelopment`). Open: career-rate calibration (Azmi), potential range on the profile,
player traits.

### M5: Contracts and cap (done)

**Done when:** no illegal contract can be made by players or AI; the cap sheet matches a
hand-checked example.

Done: every CBA check from the ruleset (terms, min/max, variance, entry-level deals,
buyouts and dead cap, retention, ceiling, floor, 10% offseason overage), cap sheet and
advisor, re-signing, extensions, RFA offer sheets with compensation picks, signing and
performance bonuses, no-trade clauses. Open: waiver flow for no-trade, 35+ contracts, the
23-player maximum.

### M6: Value and AI GMs (done; calibration open)

**Done when:** the AI makes trades a hockey fan would call realistic over a 10-season run
(spot-check log); obvious exploits (3-for-1, dumping bad contracts for free) fail.

Done: surplus value per team, pick value curve, trades v1 (cap, positions, depth discount,
full price for bad contracts, retention, picks for three drafts, a reason for every answer),
weekly AI-to-AI trades, AI offers to you, trade block, protected picks, AI GM styles and
skill, free agency with an interest meter and AI offers day by day. These engines ship as
they are; open is calibration against real trades and signings (Azmi).

### M7: Living league (mostly done)

**Done when:** simming a season produces a feed you'd actually read, and the sim stops on the
moments that need you.

Done: named feed, league pulse, playoff odds and power rating, race nights, sim until it
matters, streaks and slumps, trade requests with a talk, holdouts for your team, morale,
chemistry. Open: hot seat (after owner & finance), AI-team holdouts, a general event engine
with choices.

### M8: Screens and polish (mostly done)

**Done when:** a new player can play a full season and offseason without help, and every
screen opens under 200 ms in a year-20 save.

Done: every loop screen (Home, Roster, Lines with drag and drop and PP/PK, Player, Trades,
Draft, Free agency, Standings, Team pages, Cap, Games, Leaders, History), Cmd+K, first-run
walkthrough, English and French, year-20 screen data in the speed test. Open: faces on
Leaders and news.

---

## Phase 2

Part of the first release (list in [ROADMAP.md](ROADMAP.md#phase-2-part-of-the-first-release-one-headline-each)).
Each headline gets a milestone here once its brief exists. Owner & finance comes first.

## Release prep (last)

Not started. Comes after Phase 2, since the first release is Phase 1 + 2.

Steam store page early for wishlists, Steamworks build, a few achievements, Workshop for
roster files, closed playtest, partnership agreement, legal consult, price and Early Access
text. **Done when:** Early Access launches.
