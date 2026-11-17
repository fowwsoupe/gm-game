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
 *   awards, offseason,       the yearly rollover and trades, built from the engines above
 *   trades
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
  finishRollover,
  lotteryOrder,
  resignOffers,
  RFA_DISCOUNT,
  roomFor,
  scoutReport,
  signFreeAgent,
  signingInterest,
  stayChance,
} from './offseason';
export { giveSeasonAwards } from './awards';
export * from './trades';
export * from './sports';
export { defaultModels, type Models } from './models';
export { defaultContext, RULESETS, SPORTS, type ModelOverrides, type SimContext } from './context';
export { createLeague, START_SEASON } from './create';
export { handleCommand } from './commands';
export { playerProfiles } from './profiles';
export { dashboard } from './dashboard';
