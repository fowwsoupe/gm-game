import type { Rng } from './rng';

/**
 * Ids come from the seeded Rng, never from the clock or Math.random, so a replayed
 * season produces identical ids.
 */
export function makeId(prefix: string, rng: Rng): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[rng.int(0, 35)];
  return `${prefix}_${s}`;
}

/** Deterministic, sortable event id: season, day, then a sequence within the day. */
export function eventId(season: number, day: number, seq: number): string {
  return `ev_${season}_${String(day).padStart(3, '0')}_${String(seq).padStart(4, '0')}`;
}
