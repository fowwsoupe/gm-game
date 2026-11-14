# Working together

## Branches and PRs

- `main` is always runnable. Nobody pushes to it directly.
- Branch per task: `feat/trade-logic`, `fix/standings-tiebreak`, `chore/ci`.
- Open a PR, CI must pass (`pnpm check`), the other person reviews and merges.
- Small PRs. If it touches the sim and the UI, it's often two PRs.
- Squash-merge so `main` history reads as one line per feature.

## Commits

Conventional style keeps the log readable:
`feat(sim): add player aging`, `fix(ui): standings sort`, `chore: bump deps`.

## Splitting the work

The package boundaries make it easy to work in parallel without conflicts:

- One person on `packages/sim` (+ `ml/`): the engine and balance.
- One person on `apps/desktop` (UI, Steam) and `packages/data`.
- The contract between you is `packages/shared` (types + `GmApi`). Change it in its own
  small PR first and agree on it, then both sides build against it.

## Before you push

```bash
pnpm check   # format, lint, typecheck, tests
```

## Balance changes

Any change to the sim's numbers should say in the PR what it did to league averages
(goals/game, shots, points spread) for a fixed seed. The tests in `packages/sim` are the
starting point.
