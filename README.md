# GM Game

A sports GM game for Steam: own and run one or more teams, starting with hockey.
(Working title. Rename freely.)

## Quick start

Requires Node 22+ and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev        # opens the game with hot reload
pnpm check      # format + lint + typecheck + tests (run before every PR)
pnpm dist       # packaged build in apps/desktop/release/
```

## Layout

```
apps/desktop      Electron app: main process, preload, React UI, Steam
packages/shared   types, roster file schema, UI↔main contract
packages/sim      the game engine (pure TypeScript, seeded, tested)
packages/data     SQLite save files
ml/               Python model training → models/*.onnx
docs/             architecture and decisions
```

Read [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first, then [CONTRIBUTING.md](CONTRIBUTING.md). Full feature spec: [docs/FEATURE_SPEC.md](docs/FEATURE_SPEC.md).

## Stack

React 19 + TypeScript, Vite (electron-vite), Tailwind 4, TanStack Table / Virtual / Query,
Zustand, ECharts, PixiJS, Electron, better-sqlite3, steamworks.js, ONNX Runtime for ML.
shadcn/ui components get added as needed with `pnpm dlx shadcn@latest add <component>`.
