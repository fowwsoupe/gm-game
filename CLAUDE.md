# Notes for Claude and other coding agents

Read `docs/ARCHITECTURE.md` before changing code. The short version:

- pnpm monorepo. Run `pnpm check` before calling a task done; it must pass.
- `packages/sim` is pure TypeScript: no Node APIs, DOM, React, database, `Math.random()` or
  `Date`. All randomness through `Rng`. ESLint enforces this; don't disable the rule.
- The UI only talks to the main process through `window.gm` (typed by `GmApi` in
  `packages/shared/src/ipc.ts`). New feature = add to `GmApi` first.
- SQL lives only in `packages/data`. Never edit an existing migration; append a new one.
- Money is integer dollars.
- Keep PRs small and scoped to one package where possible.
- Sim changes need a test, and balance changes need before/after league averages for a
  fixed seed in the PR description.
