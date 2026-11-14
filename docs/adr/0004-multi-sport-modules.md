# 0004: Multi-sport: shared engines, one module per sport

Status: accepted

## Context

The game will cover the NHL, NBA and NFL. We start with the NHL only. The GM features
(trades, contracts, free agency, draft, owner layer, news, UI) are similar across sports;
what differs is the game simulation, positions, ratings, league size and some rules.

## Decision

- Each sport is a folder under `packages/sim/src/sports/` implementing `SportModule`:
  positions, rating keys, default ruleset, league generator, team strength and game sim.
- Shared engines (core, cba, value, people, finance, league) and shared types never
  mention a specific sport. `Player.ratings` is a key/value map; `GameResult` has a generic
  score plus sport-specific `stats`.
- The save records its sport and ruleset; `defaultContext` picks the sport module from the
  ruleset.

## Consequences

- Adding the NBA = a new `sports/basketball/` folder, its ruleset, generator, game sim and
  balance-lab ranges. Shared features keep working.
- Some rules differ in kind, not just numbers (NBA soft cap and luxury tax, NFL hard cap).
  The `Ruleset` shape will grow optional sections for those when the sports arrive.
- Hockey-only code must stay in the hockey folder; reviews should push back on sport
  details leaking into shared engines.
