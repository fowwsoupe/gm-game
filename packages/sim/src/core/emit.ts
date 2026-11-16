import type { Importance, LeagueEvent, TeamId } from '@gm/shared';
import { eventId } from './ids';
import { applyEvent, type LeagueState } from './state';

/** An event without the fields the sim fills in (id, date, importance, teams). */
export type EventBody = LeagueEvent extends infer E
  ? E extends LeagueEvent
    ? Omit<E, 'id' | 'date' | 'importance' | 'teamIds'>
    : never
  : never;

/**
 * Note: every event made with `makeEvent` must be applied (via `applyEvent`) before the next
 * one is made: ids come from `state.eventSeq`, which only the reducer advances.
 */
export function makeEvent(
  state: LeagueState,
  importance: Importance,
  teamIds: TeamId[],
  body: EventBody,
): LeagueEvent {
  return {
    ...body,
    id: eventId(state.date.season, state.date.day, state.eventSeq),
    date: { ...state.date },
    importance,
    teamIds,
  } as LeagueEvent;
}

/** Makes an event, applies it to the state right away and hands it to the caller's log. */
export type Emit = (importance: Importance, teamIds: TeamId[], body: EventBody) => void;

export function emitter(state: LeagueState, log: LeagueEvent[]): Emit {
  return (importance, teamIds, body) => {
    const event = makeEvent(state, importance, teamIds, body);
    applyEvent(state, event);
    log.push(event);
  };
}
