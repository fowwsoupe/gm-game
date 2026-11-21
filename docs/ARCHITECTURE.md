# Architecture

Read this before writing code. The rules here are what keep the project easy to build on
for years; most are enforced by lint, types or tests.

## The big picture

```
 UI (React)          main process (Electron)                 sim worker
 ─────────────       ───────────────────────────────         ──────────────────────
 window.gm.          LeagueService                           handleCommand(state,
 commands.dispatch ─▶  holds LeagueState in memory  ──copy──▶  command, actor, ctx)
 (a Command)           queues commands one at a time          → events
                       applyEvent(state, e) for each  ◀─────── (state changes only
 queries refetch ◀──── SaveFile.persist(events, state)          via applyEvent)
                       (SQLite: rows + event log)
```

Three ideas carry everything:

1. **Commands in.** Every change, from a click, an AI GM or (later) a remote player, is a
   `Command` (`packages/shared/src/commands.ts`). Nothing edits game state directly.
2. **Events out.** Everything that happens is a `LeagueEvent` (`packages/shared/src/events.ts`).
   The sim returns events; one reducer, `applyEvent`, turns them into state changes. The news
   feed, Home "To do", history and multiplayer sync all read events.
3. **Sport, rules and models are plug-ins.** The sport is a `SportModule` (hockey today);
   league rules live in a `Ruleset`; swappable brains (development, valuation, the sport's
   game model) are interfaces with rules-based defaults. All reach the sim through
   `SimContext`, never globals.

Because the sim is seeded and state only changes through events, **any copy of the state
that applies the same events ends up identical.** Tests check this. It is what makes
multiplayer, replays and debugging work.

## Multi-sport: shared engines, one module per sport

We will ship NHL, then NBA, then NFL. **We are building the NHL only for now**, but the code
is split so the other sports slot in without touching shared engines:

- **Shared by every sport:** core, CBA math (`Ruleset` shape, contract checks), value,
  people, finance, league (calendar, schedule, standings, team status), events and commands,
  saves, and the UI shell and design system. Features built on these (trades, free agency,
  cap sheet, news feed, owner layer...) work for any sport.
- **Per sport** (`packages/sim/src/sports/<sport>/`): positions and rating keys, the game sim
  and its tuning, the fictional league generator, default rulesets, sport-specific models
  (hockey's shot-level `GoalModel`), and its balance-lab ranges. Each implements `SportModule`
  (`sports/sport.ts`) and is registered in `context.ts`.
- **Shared types stay neutral:** `Player.position` is a string, `Player.ratings` is a map of
  rating keys, `GameResult` has `homeScore` / `awayScore` / `overtime` plus sport-specific
  `stats`. Sport-specific types live in `packages/shared/src/sports/<sport>.ts`.

Rule: if code only makes sense for one sport, it goes in that sport's folder. If two sports
would need the same thing, it belongs in a shared engine.

## Packages

| Package             | What it is                                                              | May import                                              |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/shared`   | Contracts: domain types, events, commands, IPC (`GmApi`), roster schema | `zod`                                                   |
| `packages/sim`      | The game engine (pure TypeScript, see below)                            | `@gm/shared`                                            |
| `packages/data`     | SQLite saves: migrations, load/save state, persist events, queries      | `@gm/shared`, `@gm/sim` (types + API), `better-sqlite3` |
| `apps/desktop`      | Electron: main (LeagueService, worker, net, Steam), preload, React UI   | everything, but `@gm/sim` only from its root            |
| `tools/balance-lab` | Headless league-health report (`pnpm lab`)                              | `@gm/sim`, `@gm/shared`                                 |
| `ml/`               | Python: two trained models (JSON tables), calibration studies           | n/a                                                     |

## Inside `packages/sim`: engines

```
src/
  core/      rng, money, ids, calendar, LeagueState + applyEvent      (imports no engine)
  cba/       Ruleset as data, NHL_2026 default, contract rules
  players/   percentiles, builds, injuries, development model interface
  people/    personalities, priorities, morale, chemistry, holdouts, disputes
  finance/   team finances, revenue, budgets
  owner/     owners, confidence, meetings and cards
  value/     PlayerValuator: per-team surplus value (can be negative)
  league/    schedule, standings, playoffs, team status (league pulse)
  offseason/ yearly rollover: development, retirements, expiries, draft, re-sign, free agency, next schedule
  trades/    trade window, legality and the other team's answer (built on value + cba)
  sports/    SportModule interface + one folder per sport
    hockey/  NHL: team strength, generator, NHL_2026 ruleset, and the game sim:
             game.ts (the clock loop: shots, penalties, overtime; asked, a timeline for the
             match viewer, which changes nothing in the game; a human coach's bench orders,
             each one more stop on the clock), units.ts (who is on the ice),
             side.ts (a team's sides of the game, box score), shootout.ts,
             tuning.ts (HOCKEY_TUNING knobs, GoalModel)
  models.ts  Models: shared swappable brains + rules-based defaults
  context.ts SimContext: sport + ruleset + models; SPORTS and RULESETS registries
  create.ts  createLeague(seed, ctx)
  commands.ts handleCommand(state, command, actor, ctx) → events
  advance.ts  the day loop behind sim.advance (games, playoffs, pulse, AI trades, news);
              watchGame replays the day on a copy up to one team's game, for the match viewer
  profiles.ts, dashboard.ts  read-only views for the UI (player cards, Home)
  index.ts   the public API
```

**Layering** (lint-enforced): `core` imports no engine. Engines import each other **only
through their `index.ts`** (`'../cba'`, never `'../cba/ruleset'`). Apps import only from
`'@gm/sim'`. Each engine's `index.ts` comment says what it owns.

## Rules

1. **The sim is pure.** No Node APIs, DOM, React, database, `Math.random()` or `Date`
   (lint-enforced). All randomness through the seeded `Rng`; use `rng.fork('label')` per
   system so adding randomness in one place doesn't shift everything else.
2. **State changes only in `applyEvent`.** Adding a feature that changes state = add an event
   kind in `shared/events.ts`, handle it in `applyEvent` (sim) and in `SaveFile.persist`
   (data). TypeScript's exhaustive switches flag every place you forgot.
3. **Every action is a Command.** New action = add a kind in `shared/commands.ts`, its schema
   in `shared/command-schema.ts` (the typecheck fails without it) and a case in `handleCommand`.
   Validate the actor: in multiplayer, players may only command their teams. A command is
   untrusted data: main runs none before `parseCommand` has passed it.
4. **Everything is data.** Cap numbers, contract limits, season length, points, award names,
   team colours: data, never hard-coded. Read rules from `ctx.ruleset`.
5. **Models behind interfaces.** Any replacement implements the same interface as the rules-based
   default (trained only for stats to ratings and development, ADR 0005) (`GoalModel`, `DevelopmentModel`, `PlayerValuator`) and are swapped in `Models`.
   Check a new model in the balance lab against the default with fixed seeds first.
6. **SQL only in `packages/data`.** Never edit a migration after the first public build; add a new one.
7. **Money is integer dollars** (`dollars(5.5)` → 5_500_000). Never floats.
8. **Community roster files are untrusted.** Always through `parseRosterFile()`.
9. **The UI never touches game state.** It reads via `window.gm` queries and changes things
   only with `commands.dispatch`. Zustand holds UI state only (screen, language, filters).
10. **Every user-facing string is translated.** Add keys to `i18n/en.ts` and `i18n/fr.ts`.
11. **Screens are built from `ui/` components** and design tokens in `styles.css`, never
    one-off colours.
12. **Speed is tested.** `perf.test.ts` fails the build if the sim gets slower than budget.

## A hosted league: networking rules

A league played from several machines has one authority, the host: his `LeagueService`, over his
save, is the only place a command runs. A guest's game is a mirror: a `LeagueService(':memory:')`
built from the host's table rows and fed the host's events through the same `applyEvent` and
`SaveFile.persist`. The design and its limits are in `docs/research/2026-11-multiplayer-online.md`,
which also says how much of it is built.

1. **All networking lives in `apps/desktop/src/main/net/`**, and its contracts (the messages'
   schemas, the limits) in `packages/shared/src/wire.ts`. The sim, the save and the renderer know
   nothing of it: the renderer still only calls `window.gm`, and a mirror's `dispatch` sends the
   command to the host.
2. **Everything that arrives is untrusted.** A session acts on no packet before `decode`
   (`net/codec.ts`: the size, a bounded inflate, then `parseMessage`) has passed it, and a
   message that fails ends that connection and nothing else. So does a broken limit: how many
   messages, how often a `resync`, how much waits unsent, how long a peer stays silent. The
   limits are `WIRE` in `wire.ts`. New message kind = its schema in `wire.ts` first.
3. **The actor is the host's own.** No message says who sent it or for which team. The host
   builds a guest's actor from the connection the command came in on and its own seat table,
   when the command's turn comes; its id is never `local`. What only the host may do stays
   gated in `handleCommand`.
4. **A mirror never runs the sim** and never opens the player's own save. It changes only
   through `restore` (a snapshot) and `applyRemote` (the host's events, in sequence). A guest
   whose events do not follow on asks the host again (`resync`); it never guesses.
5. **Nothing is sent before it is saved.** The host sends events on from `onPersisted`, in
   queue order, and takes a snapshot between two commands.
6. **Sessions know only the transport interface** (`net/transport.ts`: packets whole and in
   order, a `peerKey` the transport vouches for, the bytes still `unsent`, nothing handed over
   after `close()`). A new transport implements it and changes no session; session tests run
   over `loopback()`, which loses packets when a test says so. `net/tcp.ts` is the direct
   connection (not encrypted: LAN and testing). `net/steam.ts` is Steam (a friends-only lobby,
   P2P packets from its members only), written against `steamworks.js`' own typings and run
   only over `net/fakeSteam.ts` so far: not verified live. On Steam the `peerKey` is a SteamID,
   and the host session is told so (`identified`): a guest's place and seat go by it, a kick
   holds for the session, and the host's save notes who held which team (`hostSeats`, a `meta`
   row no snapshot carries).
7. **Main holds one `Online`** (`net/online.ts`): this machine's own league and at most one
   session. Query handlers read `online.league` (the mirror while this machine is a guest),
   `commands.dispatch` goes through `online.dispatch`, and what only happens outside a session
   (a new league, a roster load) asks `online.alone()`. The window reaches a session only
   through `window.gm.session`; `changed` is main's one push, a signal with nothing in it,
   for what a window did not ask for. The renderer answers it in one place (`usePush` in
   `lib/queries.ts`: the lobby and every league read again), and reads where it stands from
   `useOnline`; a screen hides what a guest may not do, and main refuses it anyway.

## How to add a feature (checklist)

1. Shared contract: new types, event kinds and command kinds (with their schema) in `packages/shared`.
2. Engine logic in the right place: a shared engine if every sport needs it, else `sports/hockey/`. Export it from the folder's `index.ts`, with tests.
3. `applyEvent` and `SaveFile.persist` handle the new events; add a migration if new columns/tables.
4. A `handleCommand` case if players can trigger it.
5. A query in `GmApi` if the UI needs to read new data; then the screen, from `ui/` components.
6. Strings in `en.ts` and `fr.ts`.
7. `pnpm check` and, for anything touching sim numbers, `pnpm lab` before and after.
   `pnpm test` plays 4 seasons in the long-run tests; `pnpm test:slow` (also nightly in CI) plays the full 20.

## Decisions

See `docs/adr/` for why things are the way they are.
