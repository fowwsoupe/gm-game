import type { Rng } from '../core';

/**
 * One personality system used everywhere: morale, contract asks, trade requests,
 * free-agent priorities, press answers, locker-room chemistry, and AI GM / owner styles.
 * Traits are 0–1 weights, not labels, so they combine smoothly.
 */
export const TRAITS = [
  'loyalty',
  'ambition',
  'greed',
  'leadership',
  'temperament',
  'professionalism',
] as const;
export type Trait = (typeof TRAITS)[number];
export type Personality = Record<Trait, number>;

/** What a player cares about in a new contract. Weights sum to ~1 and shift with age. */
export const PRIORITIES = [
  'money',
  'winning',
  'role',
  'loyalty',
  'mentor',
  'home',
  'term',
] as const;
export type Priority = (typeof PRIORITIES)[number];
export type Priorities = Record<Priority, number>;

export function randomPersonality(rng: Rng): Personality {
  const p = {} as Personality;
  for (const t of TRAITS) p[t] = Math.round(rng.next() * 100) / 100;
  return p;
}
