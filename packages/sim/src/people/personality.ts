import { Rng } from '../core';

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

/** FNV-1a: a stable 32-bit number from a string. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * A player's personality, derived from his id: the same in every copy of the league and every
 * save, with nothing stored and no draw from the league's random stream.
 */
export const personalityOf = (playerId: string): Personality =>
  randomPersonality(new Rng(hash(`personality:${playerId}`)));

/** Traits strong (or, for temperament, weak) enough to mention, strongest first, at most two. */
export function notableTraits(p: Personality): string[] {
  const out: [string, number][] = [];
  for (const t of TRAITS) {
    if (t === 'temperament') {
      if (p[t] <= 0.15) out.push(['hotHeaded', 0.15 - p[t]]);
    } else if (p[t] >= 0.85) out.push([t, p[t] - 0.85]);
  }
  return out
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([t]) => t);
}
