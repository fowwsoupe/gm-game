# Notes for Claude and other coding agents

Read `docs/ARCHITECTURE.md` before changing code (it ends with an "add a feature" checklist).
Feature intent lives in `docs/FEATURE_SPEC.md`; priorities in `docs/ROADMAP.md`.

- pnpm monorepo. Run `pnpm check` before calling a task done; it must pass.
- Commands in, events out: the UI only calls `window.gm.commands.dispatch`; state changes
  only in `applyEvent` (sim) and `SaveFile.persist` (data). New event or command kinds go
  in `packages/shared` first.
- `packages/sim` is pure TypeScript: no Node APIs, DOM, React, database, `Math.random()` or
  `Date`. All randomness through `Rng`. Engines import each other only via their `index.ts`.
  Lint enforces this; don't disable the rule.
- Multi-sport: NHL only for now, NBA/NFL later. Hockey-only code goes in
  `packages/sim/src/sports/hockey/`; shared engines and shared types stay sport-neutral.
- Rules come from `ctx.ruleset`, the sport from `ctx.sport`; models from `ctx.models`. Never hard-code a rule number.
- SQL lives only in `packages/data`. Never edit an existing migration; append a new one.
- Money is integer dollars. User-facing text goes in `i18n/en.ts` and `i18n/fr.ts`.
- Build screens from `apps/desktop/src/renderer/src/ui` components and design tokens.
- Sim balance changes: run `pnpm lab` before and after and paste both reports in the PR.
- Keep PRs small and scoped to one engine or screen where possible.
- One pass: list every file the change needs and read them together (several reads in one
  message), then make every edit, then run the checks once. Never read, edit, read, edit.
- Smallest change that fully solves the task: reuse what exists, no speculative abstractions
  or scaffolding (use the `ponytail` skill if you have it).
