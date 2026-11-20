# Match viewer (2D) with coach from the bench: design brief (2026-11)

The roadmap's "Match viewer (2D) with coach from the bench" (Phase 2). The spec
([FEATURE_SPEC](../FEATURE_SPEC.md), "Presentation and performance") asks for a rink with player
discs and a puck trail, speed 1-20x, overlays and coaching from the bench, and says how: it
"animates sim events, no physics sim". This brief follows the code the job touches (the game
engine, the day loop, the saves, the Games screen, the hot seat), settles the design and splits
it into six jobs.

The design in short. When asked, the game sim writes down what it already decides (who is on
the ice, when a goalie leaves the net or is changed, each shootout attempt), and the viewer
draws that timeline and nothing else. Tonight's game is watched by replaying the day on a
throwaway copy of the league, so watching changes nothing and stores nothing. A bench order is
an ordinary command kept with the game; the game is then replayed from the same seed with the
orders so far, so everything before the order is the same game and only what comes after is
coached. With no orders the game code takes the same path and the same draws as today.

## What a real bench decides

- **Last change.** At a stoppage the visiting team puts its players out first and the home
  coach answers, so matching a line against the other team's best is mostly the home coach's.
- **The empty net.** A team trailing late takes its goalie off for a sixth skater.
- **The goalie change.** A starter having a bad night gives way to the backup.
- **The timeout.** One a team a game, mostly to rest tired players or settle the team.
- **The short bench.** Late in a close game a coach rides his best players.
- All of this, and the rink the viewer draws (200 by 85 feet, goal lines 11 feet in, blue
  lines 75 feet from the end boards), is general knowledge, not from a sourced report: check
  it before any of it becomes a number in the ruleset. Here it only picks orders and draws
  lines.

## What exists today

| Piece          | Status                                                                                                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Game engine    | `sports/hockey/game.ts`, `playGame`: competing random clocks (a shot and a penalty per side); `refresh` sends out units and recomputes the rates at every shift end (`shiftSeconds`, 45), goal, penalty start or end, and goalie-pull time         |
| On the ice     | `buildUnit` (`units.ts`) picks a forward line and a pair by `ICE_TIME` shares (two draws a side), or a power-play / penalty-kill unit; kept in `Side.onIce`, never recorded                                                                        |
| The goalie     | pulled by rule in `refresh` (down one or two, `pullSeconds` 150 / 90 before the end of regulation); relieved by rule (`goalieIn`: four against before 45:00 at `pulledAfterFour`, or hurt); neither moment is recorded                             |
| Box score      | `HockeyBoxScore`: every shot `[second, side, x, y, shooter, goal, assist, assist, power play]` and penalty `[second, side, skater, minutes]`, ice time, goalie lines. `resultOnly` keeps none of it and rolls other dice (injuries need the box)   |
| Shootout       | `playShootout` sends shooters in order of skill and returns only the winner                                                                                                                                                                        |
| Coaching       | the coach is rating points on every player (`strengthFor` in `tonight.ts`); line matching is a `TODO(feature)` in `strength.ts`; nothing in the engine gets tired, and there is no timeout or momentum                                             |
| The day loop   | `advance.ts`: one league `Rng` from `state.rngState` runs through the day's games in schedule order (not forked per game); the day opens with moves that change lineups (`aiFarmMoves`, camp orders released); a team's strength is built per call |
| Saved          | `game.final` goes in the log without its box; the box is JSON in the games table; `state.results` holds this season only                                                                                                                           |
| Exhibition     | `league.exhibition({ homeTeamId, awayTeamId, seed })`: `simGame` on `new Rng(seed)`; changes nothing, the same seed gives the same game                                                                                                            |
| Games screen   | `Games.tsx`: matchup picker, played games, and `Replay`: a clock over the stored box (60 / 180 / 600 game seconds a second on a 100 ms timer), pause, restart, skip, a play-by-play feed, a `ShotMap` SVG of one zone with hard-coded colours      |
| Design preview | `#/preview`: mock data, never talks to the sim; the sim "ends on a result card"; no match view                                                                                                                                                     |
| Hot seat       | one local actor controls every human team (`controls` in the sim's `commands.ts`); the renderer keeps the seat and a curtain (`stores/ui.ts`)                                                                                                      |
| Team colours   | none in the data: `--team-primary` is the accent for every team; only the preview's mock teams have colours                                                                                                                                        |
| Drawing tools  | React 19, Tailwind 4 tokens, framer-motion; no canvas or animation library                                                                                                                                                                         |
| Speed          | `perf.test.ts`: a season under 5 s, a day under 250 ms                                                                                                                                                                                             |

So the stored box already has every shot and penalty with its second and place, and `Replay`
already runs a clock over it. What a rink needs and nobody keeps is who is on the ice, when the
net is empty or the goalie changes, and the shootout's attempts. The engine decides all three
without a record, so writing them down costs no random number. And nothing lets anyone decide
anything during a game.

## Design

**The sim writes a timeline when asked.** A flag on the game a sport is asked to play
(`timeline`, sport-neutral, next to `resultOnly` in `SportModule.simGame`) makes `playGame` keep
four more lists. They ride inside the hockey box, so no sport-neutral type grows
(`GameResult.box` is already `unknown` to shared code):

```ts
/** What the box does not keep (`HockeyBoxScore.timeline`). Skaters by index, as in `shots`. */
export interface HockeyTimeline {
  /** Each side's first defenceman in `skaters` (forwards come first). */
  firstD: [number, number];
  /** [second, side, skaters on the ice], each time a side's unit changes. */
  shifts: [number, 0 | 1, number[]][];
  /** [second, side, what]: 0 = goalie pulled, 1 = goalie back, 2 = the other goalie in. */
  goalies: [number, 0 | 1, 0 | 1 | 2][];
  /** [second, side, skater]: he leaves the game hurt. */
  hurt: [number, 0 | 1, number][];
  /** Shootout attempts in order: [side, skater, 1 = goal]. */
  shootout: [0 | 1, number, 0 | 1][];
}
```

Recording draws nothing and takes no branch the game does not already take. Measured in job 1
over the 1,500 pinned games of `game.test.ts`: 165 shift rows and 3.8 kB of JSON a game (4.6 kB
at most; a long playoff overtime reached 6.5 kB), beside a box of 5.8 kB. Only the exhibition
and the watch below ask for it. `advance` never does, so league sims, saves and the event log
stay as they are.

What job 1 found in the code, for the jobs that draw:

- **Seconds are whole**, rounded as a shot's is, and each list is in the order it happened. So
  a shift row and a shot in the same second can be either way round: a goal and the change
  after it share a second. At a shot's second the viewer shows the unit that has the shooter
  (the one out before that second, or one sent out during it).
- **The extra attacker is a body only at even strength.** With the net empty on a power play or
  a penalty kill, `buildUnit` sends the usual five or four and only the shot rate counts the
  extra man, so the rink shows six skaters at even strength and no more than five otherwise.
- **A unit can list a skater twice.** When two skaters of a unit are hurt, `buildUnit` sends the
  same spare for both and the engine counts him twice (his ice time too); one of the 1,500
  games has it. The timeline shows what the engine did and the viewer draws him once. Fixing it
  changes uncoached games, so it is a balance change of its own, not part of this job.
- **Ice time summed from `shifts`** was never more than 0.1 minute off the box for any skater in
  those games (the box rounds to a tenth of a minute, the timeline to a second).

**Replay, do not store** ("replay instead of store", FEATURE_SPEC).

- An exhibition replays from its seed, as today.
- Tonight's game replays from the league. `watchGame` (in `advance.ts`, beside the loop it taps;
  this brief first put it in `tonight.ts`, which `advance.ts` imports, so that would have been a
  cycle) runs the day's own code, `advance`, on a copy of the state with a tap: the watched
  team's game is played with `timeline` on and `advance` returns right after it. The copy and
  its events are thrown away. Nothing shorter is right: the game's random numbers start where
  the day's earlier games left the league stream, and its lineups are final only after the
  day's opening moves. Running the same code is right by construction, and it costs less than
  one day (budget 250 ms; measured in job 3, see default 2).
- A played league game cannot be replayed: the state it was played from (that day's lineups,
  injuries, linemates, form) is gone. It keeps today's box replay, which already shows every
  shot and penalty on a clock.

**Watching changes nothing.** `watch` is a read, like `exhibition`. The game is still played by
the next `sim.advance`, by the same code from the same state, so it is the game that was
watched (the first day of a call is built from the state alone, whatever the call's length).
The viewer ends on a last card, the box score as today, with one button that sims the day;
leaving early leaves the game unplayed and its orders kept. Watching without giving an order is
not coaching: the result is the one a plain sim gives.

**An order is a command; the game is replayed with it.**

- Contract, in `packages/shared` first: the command
  `bench.order { gameId, teamId, at, order, value? }`, the event `bench.ordered` with the same
  fields, `BenchOrder` in `domain.ts`. `at` is a game second. The order names belong to the
  sport (`BENCH_ORDERS` in `sports/hockey.ts`, checked by the sport module as `unitOk` checks a
  unit), so the shared types stay neutral.
- State: `LeagueState.bench[gameId]`, appended in `applyEvent`, dropped when that game's
  `game.final` is applied; saved as JSON in `meta` like the depth charts (no migration).
- `handleCommand` refuses an order unless the actor controls the team (`controls`), the team
  plays that game today and it is not played yet, the sport accepts the order for that side,
  and `at` is not before the last order already given in that game.
- `advance` hands each game its orders (`orders`, next to `timeline` on the game the sport
  plays). `playGame` treats an order's second as one more boundary in its clock loop, like a
  shift end or a penalty expiring: it applies the order there and calls `refresh`.
- Why this keeps every promise. With no orders the loop has no new boundary: the same path and
  the same draws as today. With an order at second T every draw before T is the same, so the
  game up to T is the same game and only what follows differs. The viewer therefore needs no
  game that stops and resumes: after an order it asks `watch` again, gets the whole game
  replayed from the seed with the orders so far, and carries on from its clock. No mid-game
  state is saved or sent, the game stays one pure function of the league, the seed and the
  orders, and a second copy that applies the events ends up identical.
- The viewer pauses its clock for the round trip (one command, one replay) and sends the next
  whole second as `at`.

**Which orders.** One rule picks them: an order acts through something the engine already
models, so it adds no tuning number and its cost is real. Three pass.

| Order                                                 | What the engine does                                                                                                                                                                               | Its cost                                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty the net, goalie back (`emptyNet`, `goalieBack`) | from the first of them the side's net is the coach's for the rest of the game, in place of the `pullSeconds` rule: empty while his team trails in regulation (the extra attacker `buildUnit` adds) | a shot at the empty net scores at `emptyNetGoal` (0.7)                                                                                               |
| Change the goalie (`goalieChange`)                    | the engine's `goalieIn`: the backup comes in, once, as when the rule or an injury does it                                                                                                          | the backup's rating and his form tonight, drawn at the start and hidden like the starter's                                                           |
| Match a line (`match`, line 1-4, 0 = off; home only)  | at five-on-five, when the visitors' first line comes out, the home coach answers with the line he named; that line's other shifts go to his other lines by their shares                            | the named line plays the first line's minutes: by `ICE_TIME`, a third line goes from 0.20 of the time to 0.38 and his own top line from 0.38 to 0.29 |

Left out, and why:

- **Timeout.** Nothing in the engine tires or tilts, so a timeout would do nothing or need an
  invented number.
- **Shorten the bench.** The gain exists (`ICE_TIME` shares) but its cost does not (no fatigue
  within a game), so it would be right every time. It waits for in-game fatigue, a balance
  change with its own lab runs.
- **Changing lines during a game.** `lines.set` before the game already does it.

AI teams give no orders: their bench is today's rules, so no game without a human coach
changes. That makes every order an edge only humans have, so each bench job measures it (the
obvious use against never, over at least 2,000 seeded games, in the PR). If one is worth more
than 0.05 goals a game, the fix is a limit on the order (for the empty net, how early it may be
used), not a retune of the engine, which would move every uncoached game.

**Hot seat.** Orders carry their team and pass `controls` like every command, and the local
actor controls every human team, so two GMs at one machine need nothing new in the sim. A GM is
offered his own team's game. When two human teams meet, both benches are on the one screen and
both GMs watch together: no curtain during a game, since the rink shows nothing private (no
ratings, no form). Orders apply in game-time order, whoever gave them. With more than one human
GM the last card does not sim the day (another GM may still want his game): it goes back to
Home, and the day is simmed from there as today.

**Drawing the game.** Nothing is simulated twice. The drawing is one pure function,
`scene(game, t)` (`lib/rink.ts` in the renderer), from the box, the timeline and a game second
to disc and puck positions. It keeps no state between frames and rolls no dice (where it wants
variety it mixes the event's index), so pausing, changing speed or a replay after an order
cannot make it drift, and the score on screen is the box's goals up to `t`, as in `Replay`
today.

| From the sim, exact                                      | Drawn, presentation only                                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| who is on the ice, and each change                       | where a disc stands between shots: a formation that follows the puck, forwards ahead of it and defence behind (told by `firstD`) |
| each shot: second, place, shooter, goal or save, assists | the puck's way there: assist to assist to shooter on a goal, then to the net                                                     |
| each penalty: who, when, how long                        | his disc in the box until a shift row brings him back (or a power-play goal, or overtime)                                        |
| the empty net, the goalie change, a player hurt          | the disc going to the bench                                                                                                      |
| each shootout attempt                                    | one skater in from centre ice                                                                                                    |
| nothing                                                  | where the puck is between two events: a smooth path from the last to the next                                                    |

The drawn layer never shows an event the timeline lacks (no extra shot, save, hit or whistle)
and feeds no number: no possession, zone time or pass count comes from it.

- **SVG, nothing new installed.** Two units, two goalies, a puck and a trail are about twenty
  nodes, far below where canvas pays. SVG takes its colours from the tokens, scales cleanly on
  the fixed canvas and gives hover and click on a disc for free; `ShotMap` is SVG already.
- **One `requestAnimationFrame` loop** keeps the clock in a ref and writes each node's
  `transform`; React renders ten times a second for the clock, the score and the feed, as
  `Replay` already did, and never touches a disc. Input never waits for an animation: pause,
  speed and the bench buttons act on the next frame, and UI transitions stay inside the
  stylesheet's 150 ms. framer-motion stays for chrome: its springs keep their own state, so
  they cannot draw discs that must follow `t`.
- **Speed.** 1x is real time (one game second a second): 1, 2, 4, 8 and 20x, opening at 8x (a
  period in two and a half minutes), with today's pause and skip to end. The box replay of
  played games keeps its faster speeds.
- **Colour-blind safe.** A side is told by shape, never by hue alone: home a solid disc, away a
  ring, goalies a double ring; a goal a filled mark, a save a hollow one. `ShotMap`'s
  hard-coded colours move to the tokens (`--color-good` blue and `--color-bad` orange).
- **Team colours from the team.** `teamColors(id)` gives a primary and a secondary, derived
  from the team's id as `market`, `gm` and `coach` are when absent; job 6 lets a roster file
  set them (`Team.colors`). No colour table in the renderer. When two primaries are too close
  the away side wears its secondary (`sideColors`).
- **Reduced motion.** Discs jump from event to event; no trail, no flash.

What job 2 found, for the jobs that draw more:

- **A shot's place can lie outside the boards.** The engine rolls a distance of 8 to 60 ft and
  an angle around the net that can pass 90 degrees, so a place can be far behind the goal line
  or wide of the side boards: 276 of the 6,725 shots of 120 pinned games (175 of them behind
  the goal line). The box, the shot map and the shot model keep the rolled place; the rink
  draws it at the nearest boards. Moving the roll changes uncoached games: a balance change of
  its own.
- **Shots can share a second** (54 of those 6,725 follow one in their own second). The rink
  spreads them in order inside that second, the last one on it, so the score at every whole
  second is the box's.
- **A change and a shot in one second**: the change is drawn on the side of the shot that
  leaves the shooter on the ice, so he always has a disc at his shot.
- **The penalised skater is not kept off the ice by the engine.** `buildUnit` can send him out
  to kill his own penalty: in 374 of 708 penalties of those games a unit has him again before
  his two minutes are up (a power-play goal ends some early; 191 times it is the very next
  unit). The rink seats him in the box only while no unit has him. His box also empties on a
  power-play goal (the oldest minor ends) and when regular-season overtime starts (the engine
  clears the penalties). Keeping him off the ice changes uncoached games: not this job.
- **Ends are fixed.** The home side defends the left net all game; changing ends by period is
  one sign in `scene`.
- **The stylesheets animate `transform` and `opacity` on every node** (150 ms in the app, 200 ms
  in the preview), which would make each disc lag its own clock: the rink's moving nodes switch
  transitions off.
- **The feed is the rink in text.** Everything drawn that the sim produced is also a feed line
  (new: empty net, goalie change, a player hurt, each order).
- **Overlays** (job 6), each a toggle: the shots so far on the rink, names on discs, the
  strength and power-play clock, each bench's ice time so far (summed from `shifts`).

**Where it lives.** In the Games screen, not a new one: `Replay` shows the rink above the feed
when the box has a timeline (exhibitions, tonight's game) and is unchanged when it has none.
Home's next-game tile gets Watch on a game day. (Job 3 found the tile empty in the playoffs:
`dashboard` read the next game from the schedule, which holds the regular season only. It now
reads a playoff game from the team's open series, at home as the day loop has it.) The preview
gets a match view fed by one seeded
game saved as a fixture (the preview never talks to the sim), so the look can be judged without
a save; the rink takes its colours from CSS variables and props only, so either theme can host
it.

## What must stay the same

- The seed-pinned tests in `game.test.ts` and `sim.test.ts` pass unedited in every job, and so
  does `perf.test.ts`.
- Three new pinned checks hold the promises: a game played with and without `timeline` has the
  same result and box (job 1); the watched game is the game the next `sim.advance` plays, and
  watching leaves the state untouched (job 3); with no orders a game equals today's, and with
  one order at T every shot, penalty and timeline row before T equals the uncoached game's,
  over many seeds and random orders (job 4).
- `pnpm lab`, one seed before and after with identical reports, in the jobs that touch the game
  or the day loop (1, 3, 4, 5).

## Settled with a default

Each of these was open; the owner can overrule any of them before its job starts.

1. **Played league games get no rink.** They keep the box replay and nothing new is stored. The
   other way: store the timeline for human teams' games only (a few kilobytes a game by
   estimate, one new migration).
2. **Watching replays the day on a copy, in the main process** like `exhibition`. If job 3
   measures more than 50 ms, it moves to the sim worker, or keeps the game's inputs and stream
   position between orders. Job 3 measured it on the 16-team league (672 games): with a full
   copy, 45 to 60 ms late in a season, most of it copying the played games' boxes (4 MB). The
   copy now shares the played games, which a day only ever adds to, and a watch is 10 to 15 ms
   from mid-season to the final (the slowest single calls 30 to 110 ms on a busy machine), so
   it stays in the main process. Not measured: a 32-team roster file. The main process uses the
   sim worker's context (the user's shot model), or the game watched would not be the game
   played.
3. **Three orders**: empty the net (and put the goalie back), change the goalie, match a line.
   No timeout and no short bench until the engine has fatigue.
4. **Line matching is the home side's only** (the last change).
5. **The coach owns the net from his first goalie order** to the end of the game, and an empty
   net only acts in regulation while his team trails. The relief rule (four against) stays.
6. **AI teams never give orders.** A bench run by the AI coach's quality would change every
   game: a balance job of its own.
7. **0.05 goals a game** is the most an order may be worth when used every game (about four
   goals a season, under one win at the usual six goals a win, itself general knowledge); past
   it the order is limited, the engine is not retuned.
8. **Knowing what comes is not closed.** A GM who watches, leaves before the end and comes back
   has seen the game; an order cannot go before an earlier one, and that is all. It is the same
   as changing a line and re-simming a day today. Hosted multiplayer will need the host to hold
   the clock.
9. **1x is real time**; speeds 1, 2, 4, 8, 20; the viewer opens at 8x.
10. **SVG, drawn in code, no new dependency.** The preview's GRAPHICS.md says nothing is drawn
    in code; that is about faces and arenas, and the rink is a diagram like the shot map. The
    other way: an image under the discs.
11. **Inside Games, opened from Home**, and only your own team's game is offered. No stop on
    game days: watching is opt-in.
12. **Colours derived from the team's id** until a roster file sets them; a side is told by
    shape.
13. **Two human teams in one game watch together**, with no curtain; with several human GMs the
    last card goes back to Home instead of simming the day.
14. **A player hurt in an exhibition is shown leaving**, since that is the game that was
    played; he is not hurt afterwards, as today.

## Jobs (one PR each, in order)

Each stands alone and leaves main shippable. A job that adds text adds it to `i18n/en.ts` and
`i18n/fr.ts`; a job that changes a screen runs the Electron smoke test.

1. **A timeline out of the game sim** (done; `timeline.test.ts` holds the checks). `HockeyTimeline`
   in shared (`sports/hockey.ts`); the `timeline` flag on the game `SportModule.simGame` plays;
   `playGame` and `playShootout` record; `league.exhibition` asks for it. No screen changes.
   _Done when:_ a game with and without the flag has the same result and box over the pinned
   seeds; every shot's shooter and assists are on the ice at its second (within the box's
   one-second rounding), ice time summed from `shifts` matches the box, and an empty net shows
   an extra skater at even strength; the measured size is in the PR; lab identical on one seed.
2. **The rink** (done; `lib/rink.test.ts` holds the checks). `scene(game, t)`, the SVG rink in
   `Replay` for exhibitions (discs by shape, puck and trail, 1-20x, reduced motion),
   `teamColors` from the id, feed lines for the new events, English and French, the preview's
   match view on a fixture.
   _Done when:_ tests on `scene` pass (the same `t` gives the same picture, every disc is
   inside the boards or in a penalty box, shooter and puck are at the shot's place at its
   second, everyone on the ice has one disc, the score at any whole second is the box's); an
   exhibition plays at every speed and pause and speed answer while it runs (Electron smoke
   test).
3. **Watch tonight's game** (done; `watch.test.ts` holds the checks). The tap in `advance`,
   `watchGame` beside it in `advance.ts`, `GmApi.league.watch({ teamId })`, Watch on Home on a
   game day (season and playoffs; `dashboard` gives the playoff game), the last card (sim the
   day with one human GM, back to Home with several).
   _Done when:_ the pinned check holds for a regular-season and a playoff game; the query's
   time is in the PR; lab identical on one seed; smoke test.
4. **Bench: the goalie.** The `bench.order` contract, state, save, the checks in
   `handleCommand`, orders into `simGame`, the three goalie orders, a bench panel for each
   human side.
   _Done when:_ the pinned checks hold (no orders equals today; the game before an order is
   untouched); a second copy replaying the events is identical and a save round trip keeps the
   orders; an order for an AI team, for a game not played today or before an earlier order is
   refused; two human teams in one game can both order; the measured edge is in the PR; lab
   identical on one seed; smoke test.
5. **Bench: match a line.** The `match` order for the home side at five-on-five.
   _Done when:_ the named line's ice time moves as the shares say and the box still adds up
   (ice time, plus-minus); job 4's pinned checks hold with it; the measured edge of each choice
   is in the PR; lab identical on one seed; smoke test.
6. **Overlays and team colours.** The four overlays, shootout attempts on the rink,
   `Team.colors` from a roster file, `ShotMap` on the tokens.
   _Done when:_ each overlay agrees with the box (ice time within rounding); a roster file's
   colours show on the rink and a bad value is refused with a readable error; smoke test.

Not in scope: a rink for played league games; timeout, short bench, in-game fatigue or
momentum; defence-pair matching; orders set before a game without watching it (tactics); an AI
bench; a stop on game days, other teams' games, a ticker of the night's other scores; anything
the sim does not produce (possession, zone time, passes, hits, faceoffs, offside and icing
whistles); sound, commentary and arena art; the NBA and NFL viewers; the host holding the clock
in hosted multiplayer.
