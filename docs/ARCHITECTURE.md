# Architecture

## The big picture

```
┌──────────────────────── apps/desktop (Electron) ────────────────────────┐
│                                                                          │
│  renderer (React UI)  ──window.gm──▶  preload  ──IPC──▶  main process    │
│  Zustand: UI state only                                  LeagueService   │
│  TanStack Query: caches IPC calls                          │      │      │
│                                                            ▼      ▼      │
│                                                 sim worker    @gm/data   │
│                                                 (@gm/sim)     (SQLite)   │
│                                                                   │      │
│                                                         saves/*.sqlite   │
└──────────────────────────────────────────────────────────────────────────┘
        ▲                                    ▲
   @gm/shared (types, roster schema, IPC contract) used by everything
        ▲
   ml/ (Python, offline) ──exports──▶ models/*.onnx ──loaded by main
```

## Packages

| Package           | What it is                                                                                                  | May import                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `packages/shared` | Domain types, roster JSON schema (Zod), IPC contract `GmApi`                                                | `zod` only                     |
| `packages/sim`    | The game engine: RNG, team strength, game sim, schedule, standings, league generation. **Pure TypeScript.** | `@gm/shared` only              |
| `packages/data`   | SQLite save files: migrations and all queries                                                               | `@gm/shared`, `better-sqlite3` |
| `apps/desktop`    | Electron app: main process, preload, React UI, Steam                                                        | everything                     |
| `ml/`             | Python training, exports ONNX                                                                               | n/a                            |

## Rules (the lint config enforces the sim ones)

1. **The sim is pure.** No Node APIs, no DOM, no React, no database, no `Math.random()`,
   no `Date`. It takes data in and returns data out. This is why it can run in a worker,
   be tested in milliseconds, and later be reused for NBA/NFL.
2. **All randomness goes through `Rng`.** Same seed = same season. Store `rng.state` in the
   save. Use `rng.fork('label')` per system so adding randomness to injuries doesn't change
   every game result.
3. **The UI never touches the database or the sim directly.** It calls `window.gm.*`, which
   is typed by `GmApi` in `@gm/shared`. To add a feature: add the method to `GmApi`, then
   TypeScript tells you what's missing in preload and main.
4. **Game state lives in the save file, not in React.** Zustand is for UI state only
   (current screen, selections, filters).
5. **Heavy work runs in the sim worker**, so simming a season never freezes the window.
6. **Never edit a shipped migration.** Add a new one. Players' saves already ran the old ones.
7. **Money is integer dollars.** Never floats.
8. **Community roster files are untrusted.** Always go through `parseRosterFile()`.

## Where things will go

| Feature                                   | Where                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Trades, AI GM logic, contracts, cap rules | `packages/sim/src/…` (new modules)                                         |
| Player development / aging                | `packages/sim/src/development.ts`                                          |
| Roster import                             | `packages/shared` (schema) → main (file dialog) → `@gm/data`               |
| New screens                               | `apps/desktop/src/renderer/src/screens/`                                   |
| Charts (ECharts)                          | `apps/desktop/src/renderer/src/components/charts/`                         |
| Match viewer (PixiJS)                     | later; text play-by-play first                                             |
| ML models                                 | `ml/` → `models/*.onnx` → main implements a sim interface like `GoalModel` |
| NBA / NFL                                 | new `packages/sim-nba` etc. sharing `Rng`, schedule, standings patterns    |
| Steam achievements / Workshop             | `apps/desktop/src/main/steam.ts`                                           |

## Decisions

See `docs/adr/` for why things are the way they are.
