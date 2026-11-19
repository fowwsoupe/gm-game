import type { Actor, Command } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, type LeagueState } from './index';

/**
 * Test fixtures: leagues played once and shared by the tests in a file (vitest runs each file in
 * its own worker, so the caches never cross files). Tests only.
 */
const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

function memo<T>(make: (seed: number) => T) {
  const cache = new Map<number, T>();
  return (seed: number): T => {
    if (!cache.has(seed)) cache.set(seed, make(seed));
    return cache.get(seed)!;
  };
}

/** A new league played from camp through the regular season and the playoffs (to day 220). Not cached. */
export function playSeason(seed: number) {
  const state = createLeague(seed, ctx);
  const events = run(state, { kind: 'sim.advance', days: 220 - state.date.day });
  return { state, events };
}

/** `playSeason`, played once per seed. Shared: read it, never change it. */
export const simSeason = memo(playSeason);

const summer = memo((seed) => {
  const state = createLeague(seed, ctx);
  run(state, { kind: 'sim.advance', days: 300 - state.date.day });
  return state;
});
const freeAgency = memo((seed) => {
  const state = structuredClone(summer(seed));
  run(state, { kind: 'offseason.openFreeAgency' });
  return state;
});

/** A league played 300 days (season over, before free agency). A fresh copy each call. */
export const summerLeague = (seed: number): LeagueState => structuredClone(summer(seed));

/** `summerLeague` with free agency open. A fresh copy each call. */
export const freeAgencyLeague = (seed: number): LeagueState => structuredClone(freeAgency(seed));
