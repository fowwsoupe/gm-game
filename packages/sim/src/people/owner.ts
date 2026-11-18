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

/** A team's market size (0.65-1.75), derived from the team id. */
export const marketOf = (team: Team): number =>
  round2(MARKET.min + new Rng(hash(`market:${team.id}`)).next() * (MARKET.max - MARKET.min));
