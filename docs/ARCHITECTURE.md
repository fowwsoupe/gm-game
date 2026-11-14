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
  (hockey's `GoalModel`), and its balance-lab ranges. Each implements `SportModule`
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
| `apps/desktop`      | Electron: main (LeagueService, worker, Steam), preload, React UI        | everything, but `@gm/sim` only from its root            |
| `tools/balance-lab` | Headless league-health report (`pnpm lab`)                              | `@gm/sim`, `@gm/shared`                                 |
| `ml/`               | Python training → `models/*.onnx`                                       | n/a                                                     |

## Inside `packages/sim`: engines

```
src/
  core/      rng, money, ids, calendar, LeagueState + applyEvent      (imports no engine)
  cba/       Ruleset as data, NHL_2026 default, contract rules
  players/   percentiles, development model interface, (later) builds, injuries
  people/    personalities, priorities, (later) morale, chemistry
  finance/   team finances, (later) revenue, budgets
  value/     PlayerValuator: per-team surplus value (can be negative)
  league/    schedule, standings, team status (league pulse)
  sports/    SportModule interface + one folder per sport
    hockey/  NHL: game sim, team strength, GoalModel, generator, NHL_2026 ruleset
  models.ts  Models: shared swappable brains + rules-based defaults
  context.ts SimContext: sport + ruleset + models; SPORTS and RULESETS registries
  create.ts  createLeague(seed, ctx)
  commands.ts handleCommand(state, command, actor, ctx) → events
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
3. **Every action is a Command.** New action = add a kind in `shared/commands.ts` and a case
   in `handleCommand`. Validate the actor: in multiplayer, players may only command their teams.
4. **Everything is data.** Cap numbers, contract limits, season length, points, award names,
   team colours: data, never hard-coded. Read rules from `ctx.ruleset`.
5. **Models behind interfaces.** ML models implement the same interface as the rules-based
   default (`GoalModel`, `DevelopmentModel`, `PlayerValuator`) and are swapped in `Models`.
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

## How to add a feature (checklist)

1. Shared contract: new types, event kinds and command kinds in `packages/shared`.
2. Engine logic in the right place: a shared engine if every sport needs it, else `sports/hockey/`. Export it from the folder's `index.ts`, with tests.
3. `applyEvent` and `SaveFile.persist` handle the new events; add a migration if new columns/tables.
4. A `handleCommand` case if players can trigger it.
5. A query in `GmApi` if the UI needs to read new data; then the screen, from `ui/` components.
6. Strings in `en.ts` and `fr.ts`.
7. `pnpm check` and, for anything touching sim numbers, `pnpm lab` before and after.

## Decisions

See `docs/adr/` for why things are the way they are.
