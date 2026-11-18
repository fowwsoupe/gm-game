/**
 * Core: the base layer every engine may use. Imports nothing from other engines.
 */
export { Rng } from './rng';
export { eventId } from './ids';
export { dollars, pct, formatDollars, type Dollars } from './money';
export { phaseOf, type CalendarConfig } from './calendar';
export {
  applyEvent,
  linemateKey,
  LINEMATE_GAMES_CAP,
  type LeagueState,
  type ScheduledGame,
} from './state';
export { makeEvent, emitter, type Emit, type EventBody } from './emit';
