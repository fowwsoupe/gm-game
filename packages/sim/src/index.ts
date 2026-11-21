/**
 * @gm/sim public API. Apps import from here only, never from engine internals.
 *
 * Multi-sport: shared engines are sport-agnostic; each sport is a module in sports/
 * (hockey today; basketball and football later) implementing SportModule.
 *
 * Layers (an engine may import only from layers above it in this list, and only through
 * that engine's index.ts):
 *   core                     rng, money, ids, calendar, league state + reducer
 *   cba, players, people,    shared rules and pure building blocks
 *   finance
 *   value, league            shared decisions and league structure
 *   awards, offseason,       the yearly rollover, trades and owner meetings, built from the
 *   trades, owner            engines above
 *   sports/<sport>           sport-specific: positions, ratings, game sim, generator, rulesets
 *   models, context,         wiring: sport + rules + swappable brains, commands
 *   create, commands
 */
export * from './core';
export * from './cba';
export * from './players';
export * from './people';
export * from './finance';
export * from './value';
export * from './league';
export {
  rolloverSeason,
  openFreeAgency,
  lotteryOrder,
  MARKET_DAYS,
  resignOffers,
  roomFor,
  walkAway,
  scoutReport,
  sheetCompensation,
  counterSalary,
  lineOf,
  signFreeAgent,
  signingInterest,
  stayChance,
  talksLeft,
  staffCandidates,
  departmentReturns,
  interimHead,
  teamRange,
  onTheClock,
  picksLeft,
} from './offseason';
export { legendTrophies } from './awards';
export { ownerStanding } from './owner';
export * from './trades';
export * from './sports';
export type { Models } from './models';
export { defaultContext, type ModelOverrides, type SimContext } from './context';
export { createLeague, START_SEASON } from './create';
export { handleCommand } from './commands';
export { watchGame } from './advance';
export { playerProfiles } from './profiles';
export { dashboard } from './dashboard';
export { available, sitsOut, strengthFor } from './tonight';
