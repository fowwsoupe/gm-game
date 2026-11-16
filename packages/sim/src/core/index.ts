/**
 * Core: the base layer every engine may use. Imports nothing from other engines.
 */
export { Rng } from './rng';
export { makeId, eventId } from './ids';
export { dollars, pct, formatDollars, type Dollars } from './money';
export { phaseOf, addDays, compareDates, type CalendarConfig } from './calendar';
export { applyEvent, type LeagueState, type ScheduledGame } from './state';
export { makeEvent, emitter, type Emit, type EventBody } from './emit';
