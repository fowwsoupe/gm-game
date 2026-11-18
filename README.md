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
ml/               Python calibration: real NHL studies → engine numbers and lab targets
tools/balance-lab league-health report (pnpm lab)
docs/             architecture and decisions
```

Start here:

- [docs/ROADMAP.md](docs/ROADMAP.md): what the game will have and the status of each part
- [docs/PLAN.md](docs/PLAN.md): who owns what, the job queue ("Next up") and each milestone's "done when"
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), then [CONTRIBUTING.md](CONTRIBUTING.md)

Reference: [feature spec](docs/FEATURE_SPEC.md), [decisions](docs/adr/), [research](docs/research/),
[ratings](docs/RATINGS.md), [data rights](docs/DATA_RIGHTS.md).

## Stack

React 19 + TypeScript, Vite (electron-vite), Tailwind 4, TanStack Table / Virtual / Query,
Zustand, ECharts, PixiJS, Electron, better-sqlite3, steamworks.js. No ML runtime ships: the engine is
rules-based and calibrated from `ml/` studies; optional model tables are JSON
([docs/MODEL_CONTRACTS.md](docs/MODEL_CONTRACTS.md)).
shadcn/ui components get added as needed with `pnpm dlx shadcn@latest add <component>`.

## Troubleshooting

**`better_sqlite3.node was compiled against a different Node.js version`**: the SQLite
add-on is built for one runtime at a time. `pnpm dev` rebuilds it for Electron and
`pnpm test` / `pnpm check` rebuild it for Node, automatically. If you still see it, run
`pnpm --filter @gm/desktop native:electron` (for the app) or `pnpm native:node` (for tests).

**Steam messages at startup** (`SteamAPI_Init() failed`): normal when Steam isn't running.
The game runs without Steam.
