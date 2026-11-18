# 0003: Rules as data, models as plug-ins

Status: accepted; the role of ML models is narrowed by [0005](0005-engine-first-ml-for-calibration.md)
(rules-based engines ship, models are optional).

## Context

League rules change (new CBA terms, cap growth) and players want sandbox leagues. ML models
for shots, development and value will arrive over time and must be compared fairly with
simpler rules-based versions.

## Decision

- All league rules live in a `Ruleset` object (`packages/sim/src/cba`), versioned as data
  files. The default is `NHL_2026` (2026-27 payroll range, 84 games, current CBA limits).
- Swappable "brains" implement small interfaces (`GoalModel`, `DevelopmentModel`,
  `PlayerValuator`) and are grouped in `Models`, with rules-based defaults.
- Rules and models reach the sim through `SimContext`, passed explicitly.

## Consequences

- Sandbox settings, classic rules or a future CBA are new data, not code changes.
- Any model can be swapped in tests and in the balance lab with fixed seeds.
- Engines must never read a number that belongs in the ruleset from a constant.
