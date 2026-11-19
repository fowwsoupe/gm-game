/**
 * Core: the base layer every engine may use. Imports nothing from other engines.
 */
export { Rng } from './rng';
export { teamName, playerName } from './names';
export { FIRST, LAST } from './namePools';
export { dollars, pct, type Dollars } from './money';
export { phaseOf, type CalendarConfig } from './calendar';
export {
  applyEvent,
  capYearOf,
  linemateKey,
  pairKey,
  prospectsOf,
  type LeagueState,
  type ScheduledGame,
} from './state';
export { makeEvent, emitter, type Emit, type EventBody } from './emit';
