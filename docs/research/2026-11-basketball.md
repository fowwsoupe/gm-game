# Basketball (NBA): design brief (2026-11)

Phase 3's first line, "NBA, then NFL, on the same engines" ([ADR 0004](../adr/0004-multi-sport-modules.md)).
Every Phase 2 headline is done, so this is the next one with no brief. It says where the shared
engines already fit a second sport, where hockey has leaked into them, what the NBA needs that
hockey never did, and splits the work into jobs. NFL waits for what this teaches. Hockey must
play exactly as today at every step: the lab stays flat on seeds 1, 101 and 201.

## What the NBA does differently

- **Money is a soft cap.** A team over the cap can still sign its own players (Bird rights),
  use exceptions, and take salary back in trades; what stops it is a luxury tax line and two
  aprons that close those routes one by one. Hockey's cap is a wall; here it is a price.
- **Few, big contracts.** About 15 standard deals, up to three two-way deals, a max salary
  that rises with years of service, and a handful of stars deciding a season.
- **More randomness goes to the better team.** The better team wins a best-of-7 about 80% of
  the time, against just above 60% in the NHL ([research](2026-11-sports-gm-research.md)).
  Spread, repeatability and playoff turnover targets are all different from hockey's.
- **Positionless, one lineup.** Five on the floor, a rotation of about ten, minutes set by
  the coach; no goalie, no lines, no power play.
- **A different calendar.** 82 games, no ties or shootouts (so no overtime-loss point), 30
  teams, a play-in for seeds 7 to 10, four best-of-7 rounds, a two-round draft with a lottery
  of the 14 teams that missed.
- **Prospects come from college, abroad and the G League,** not junior. Many picks are stashed
  overseas; a two-way deal is the farm team.
- Everything above is general knowledge, not from a sourced report. Job 2 starts with a source
  pass like the NHL one (cap, tax and apron lines, exceptions, max-salary tiers, two-way terms,
  lottery odds, play-in) before any of it becomes a ruleset number.

## What exists today

| Piece                       | Status                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Sport`                     | already `'nhl' \| 'nba' \| 'nfl'`; only `nhl` has a module and a `context.ts` registry entry                                                                                                                                                                             |
| `SportModule`               | covers positions, ratings, generator, prospects, awards, leaders, Hall of Fame, strength, game sim, import. Hockey-shaped parts: `specialUnits` and `unitOk` (power play and penalty kill), `benchOrderOk`, `lineup` (F1-F4, D1-D3, G), `homeBackToBack` (backup goalie) |
| Shared and neutral          | value, people, finance, owner, trades, free agency, draft, news, league pulse, odds (`pythagoreanExponent` is the sport's)                                                                                                                                               |
| `Ruleset`                   | one cap shape with a `TODO(nba/nfl)` for soft cap and tax; `playoffCap` is `{ skaters, goalies }`; `points` is win and overtime loss; `draft.juniorMaxAge`, `elcYearsByAge`, RFA and offer sheets are hockey's                                                           |
| Hockey words in shared code | `goalies.setRotation` command and event, `goalieRotation` in the state and the save, `isGoalie` in `league/playoffs.ts`, `GOALIE_DEPARTMENTS` in `offseason/staff.ts`, `shootout` in `GameResult`, `roster-schema.ts` built on hockey's rating lists                     |
| Roster files                | the importer's schema is hockey's, so a basketball roster file cannot be described yet                                                                                                                                                                                   |
| Models                      | `models.ts` has a `TODO(nba/nfl)`: the development config is picked by sport                                                                                                                                                                                             |
| Lab                         | every range is an NHL range                                                                                                                                                                                                                                              |

So the module seam is real, but it has only ever held one sport. The first job proves it with a
second, tiny one before any basketball is written.

## Design

**Prove the seam with a toy sport.** A test-only `SportModule` (two positions, two ratings, a
coin-flip game) runs a league through a season, a playoff, a draft and a summer using only the
shared engines. Whatever breaks is a hockey leak; fix each in its own place (the rule is the
same as ever: sport code in `sports/<sport>/`, the rest sport-neutral). Known leaks are in the
table above. Goalie-only commands stay hockey's but are refused for another sport; the rotation
state becomes a per-sport lineup option; staff departments come from the sport module; the
roster-file schema is chosen by sport.

**The soft cap is an optional section, not a rewrite.** `Ruleset.cap` gains `kind: 'hard' | 'soft'`
and a `soft` block (tax line, first and second apron, the tax rate, exceptions with their sizes,
the max salary by years of service). A contract check, a trade check and an offer check each ask
the ruleset what is allowed over the cap; hockey's `hard` answers exactly as now. Bird rights
become the re-sign branch of the same check (a team may exceed the cap to keep its own player).
Cap holds, sign-and-trade and the apron's trade limits come in at this layer, not in the AI.

**Value and the AI price the tax.** A dollar over the tax line costs the team the tax rate on
top of the dollar, and the owner layer already turns money into confidence: the AI GM's
surplus-value model gets a payroll-above-the-line term, and AI teams in tax trouble dump salary
the way hockey's AI fire-sales expiring players.

**Basketball is a module.** `sports/basketball/` holds: positions (PG, SG, SF, PF, C as role
labels, the game does not enforce them), rating keys (shooting by zone, finishing, playmaking,
rebounding, defence, athleticism, with their percentile groups), the fictional 30-team league,
prospects from `college`, `international` and `gleague` (`prospectLeague` and `farmLeague` already
return a league name), awards (MVP, Defensive Player, Rookie, Sixth Man, Finals MVP), leaders,
Hall of Fame, a development config by sport, a roster file schema.

**The game is a possession sim.** One possession: pace, who takes the shot (usage), shot
quality by zone against the defence, rebound, turnover, foul. Minutes come from the coach's
rotation, with fatigue and foul trouble; the box score is points, rebounds, assists, minutes and
shooting lines in `GameResult.stats`. Randomness comes only from `Rng`; a `resultOnly` mode for
odds. The game must be tuned to the NBA's spread and its better-team-wins rate, as the hockey
sim was tuned: lab ranges first, tuning after.

**The lineup becomes a rotation.** The Lines screen shows the starting five and minutes for a
basketball team; the same depth-order command orders players, with minutes derived from the
order and a coach setting. A match viewer for basketball is later: the timeline format is
hockey's, so the first release uses the box replay.

## Jobs (one PR each, in order)

1. **The toy sport.** A test-only module and a test that runs a season, playoffs, draft and
   summer on it; fix every hockey leak it finds (the table above, plus anything new) with hockey
   playing identically. _Done when:_ the test passes and the lab is flat on seeds 1, 101 and 201.
   Sonnet 5.5, high.
2. **The soft cap.** A source pass for the numbers (a new dated report), `cap.kind` and the
   `soft` block, contract, trade and offer checks that read it, Bird rights, exceptions, tax and
   aprons in the cap sheet. _Done when:_ tests for each exception, each apron limit and a Bird
   re-sign over the cap; hockey's checks unchanged. Opus 5.5, high.
3. **The league.** `sports/basketball/` with positions, ratings, the 30-team generator, the NBA
   2026 ruleset and a fictional one, prospect leagues, a development config, and the roster
   file schema. _Done when:_ a league generates under the cap, round-trips through a save and
   imports a roster file. Opus 5.5, high.
4. **The game.** The possession sim, the box score, `resultOnly`, and the lab's basketball ranges
   (points a game, better-team-wins in a best-of-7, points % spread, repeatability, playoff
   turnover) sourced the way the hockey ones were. _Done when:_ the lab is green on seeds 1, 101
   and 201 for a basketball league. Fable 5.2, xhigh.
5. **The season.** An 82-game schedule, the play-in, a 16-team bracket, the 14-team lottery and
   the two-round draft, awards, leaders, Hall of Fame, the pulse's exponent. _Done when:_ a
   basketball league plays 20 years in the lab with talent drift, dynasties and cap in range.
   Opus 5.5, high.
6. **Front office and AI.** The tax term in surplus value, AI dumping salary, free agency with
   Bird rights and exceptions, a two-way contract as the farm team, a draft with stashed picks.
   _Done when:_ a 20-year lab shows tax payrolls in range and no AI team in a payroll spiral.
   Opus 5.5, xhigh.
7. **The screens.** A sport choice when creating a league, the rotation screen, the cap sheet's
   tax and aprons, box scores, basketball words in `en.ts` and `fr.ts`, an Electron smoke test of
   a season in each sport. _Done when:_ the same build starts a hockey league and a basketball one
   and plays a season of each. Sonnet 5.5, high.

Out of scope here: NFL, a basketball match viewer, a multi-sport empire, and a league with two
sports in one save.
