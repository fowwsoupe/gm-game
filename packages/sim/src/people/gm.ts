import type { GmProfile, GmStyle, Player, Team, TeamId } from '@gm/shared';
import { Rng } from '../core';
import { hash } from './personality';

export const GM_STYLES: readonly GmStyle[] = ['winNow', 'balanced', 'builder'];

/** Each style's lean between now (1) and the future (-1), as the valuator reads it. */
export const GM_LEAN: Record<GmStyle, number> = { winNow: 1, balanced: 0, builder: -1 };

/** A new AI GM: any style, skill anywhere from poor to excellent. */
export function randomGm(rng: Rng): GmProfile {
  return { style: rng.pick(GM_STYLES), skill: Math.round(rng.next() * 100) / 100 };
}

/** A team's GM; teams from old saves and roster files get one derived from the team id. */
export const gmOf = (team: Team): GmProfile => team.gm ?? randomGm(new Rng(hash(`gm:${team.id}`)));

/** How far (SD, rating points) a GM's read of a player is off: the best GM 1, the worst 6. */
const READ_SD = { best: 1, worst: 6 };

/**
 * How many rating points this team's GM over- (positive) or underrates this player. Fixed per
 * team and player, so a poor GM keeps falling for the same players; nothing is stored and no
 * draw comes from the league's random stream.
 */
export function misread(gm: GmProfile, teamId: TeamId, playerId: string): number {
  const sd = READ_SD.best + (1 - gm.skill) * (READ_SD.worst - READ_SD.best);
  return new Rng(hash(`read:${teamId}:${playerId}`)).normal(0, sd);
}

const clamp = (n: number) => Math.max(1, Math.min(99, n));

/**
 * The player as this team's GM sees him: every rating and his potential shifted by his misread.
 * AI decisions (who to sign, keep, draft or trade for) look at this copy, never at the truth.
 */
export function seenBy(team: Team, player: Player): Player {
  const off = misread(gmOf(team), team.id, player.id);
  if (off === 0) return player;
  const ratings: Record<string, number> = {};
  for (const [k, v] of Object.entries(player.ratings)) ratings[k] = clamp(v + off);
  return { ...player, ratings, potential: clamp(player.potential + off) };
}
