# GM Game

A sports GM game for Steam: own and run one or more teams, starting with hockey.
(Working title. Rename freely.)

## Quick start

Requires Node 22+ and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev        # opens the game with hot reload
pnpm check      # format + lint + typecheck + tests (run before every PR)
pnpm lab        # balance lab: league-health report from simulated seasons
pnpm dist       # packaged build in apps/desktop/release/
```

## Layout

```
apps/desktop      Electron app: main process, preload, React UI, Steam
packages/shared   types, roster file schema, UI↔main contract
packages/sim      the game engine (pure TypeScript, seeded, tested)
packages/data     SQLite save files
ml/               Python model training → model tables (JSON) in ml/models/
tools/balance-lab league-health report (pnpm lab)
docs/             architecture and decisions
```

Read [docs/V0.1_PLAN.md](docs/V0.1_PLAN.md), [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first, then [CONTRIBUTING.md](CONTRIBUTING.md). Full feature spec: [docs/FEATURE_SPEC.md](docs/FEATURE_SPEC.md).

## Stack

React 19 + TypeScript, Vite (electron-vite), Tailwind 4, TanStack Table / Virtual / Query,
Zustand, ECharts, PixiJS, Electron, better-sqlite3, steamworks.js. ML models ship as data
(JSON tables), not as an ONNX runtime: see [docs/MODEL_CONTRACTS.md](docs/MODEL_CONTRACTS.md).
shadcn/ui components get added as needed with `pnpm dlx shadcn@latest add <component>`.

## Troubleshooting

**`better_sqlite3.node was compiled against a different Node.js version`**: the SQLite
add-on is built for one runtime at a time. `pnpm dev` rebuilds it for Electron and
`pnpm test` / `pnpm check` rebuild it for Node, automatically. If you still see it, run
`pnpm --filter @gm/desktop native:electron` (for the app) or `pnpm native:node` (for tests).

**Steam messages at startup** (`SteamAPI_Init() failed`): normal when Steam isn't running.
The game runs without Steam.
