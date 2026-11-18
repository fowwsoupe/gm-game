import type { OwnerProfile, Team } from '@gm/shared';
import { FIRST, LAST, Rng } from '../core';
import { hash } from './personality';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Market size, a multiplier on market-driven revenue: from a small town to a big city. */
const MARKET = { min: 0.65, max: 1.75 };

/** A team's owner, derived from the team id so old saves and roster files need nothing stored. */
export function ownerOf(team: Team): OwnerProfile {
  const rng = new Rng(hash(`owner:${team.id}`));
  return {
    name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
    priority: round2(rng.next()),
    patience: round2(rng.next()),
  };
}

/** A team's arena: seats between `range.min` and `range.max`, derived from the team id. */
export const capacityOf = (team: Team, range: { min: number; max: number }): number =>
  Math.round(range.min + new Rng(hash(`arena:${team.id}`)).next() * (range.max - range.min));

/** A team's ticket price step: set by its GM, else the owner's (profit owners charge more). */
export const ticketPctOf = (team: Team, set: Record<string, number>): number =>
  set[team.id] ?? (ownerOf(team).priority < 1 / 3 ? 10 : ownerOf(team).priority > 2 / 3 ? -10 : 0);

/**
 * A team's market size (0.65-1.75), derived from the team id. Squared, so most teams are small or
 * mid-market and a few are big cities (mean about 1): the balance lab's revenue spread and mean.
 */
export const marketOf = (team: Team): number =>
  round2(MARKET.min + new Rng(hash(`market:${team.id}`)).next() ** 2 * (MARKET.max - MARKET.min));
