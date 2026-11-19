import type { Player, TeamStatus } from '@gm/shared';
import type { SimContext } from '../context';
import type { LeagueState } from '../core';
import { byOverall } from '../players';
import { personalityOf } from './personality';

/** How a team's standing feels to a player (0-100). */
const WINNING: Record<TeamStatus, number> = {
  contender: 100,
  buyer: 80,
  bubble: 60,
  seller: 35,
  rebuilder: 20,
  crisis: 10,
};

export interface MoraleInput {
  teamStatus: TeamStatus;
  /** 0 = best at his position on the team; at or past `depth` he is a spare. */
  depthRank: number;
  depth: number;
  /** His cap hit over what he would ask today (1 = paid his worth). Absent: no contract. */
  paidRatio?: number;
  /** Seasons with the team. */
  seasons: number;
  /** He asked to be traded and it is not settled. */
  wantsOut: boolean;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/**
 * Morale v1, 0-100 and stateless (so nothing to save): how happy a player is right now. Four
 * things move it, each weighted by who he is: winning (ambition), his role (always), his pay
 * against his worth (greed) and time with the team (loyalty). An open trade request caps it.
 * Display only for now; it does not feed back into performance, re-signing or requests yet.
 */
export function morale(playerId: string, input: MoraleInput) {
  const { ambition, greed, loyalty } = personalityOf(playerId);
  const factors = [
    { key: 'winning', score: WINNING[input.teamStatus], weight: 0.5 + ambition },
    {
      key: 'role',
      score: clamp(100 - (input.depthRank / Math.max(1, input.depth)) * 80),
      weight: 1,
    },
    {
      key: 'pay',
      score: clamp(((input.paidRatio ?? 1) - 0.6) * 250),
      weight: 0.5 + greed,
    },
    { key: 'belonging', score: clamp(40 + input.seasons * 20), weight: 0.5 + loyalty },
  ];
  const total = factors.reduce((s, f) => s + f.weight, 0);
  const avg = factors.reduce((s, f) => s + f.score * f.weight, 0) / total;
  const value = Math.round(input.wantsOut ? Math.min(avg, 25) : avg);
  return { value, factors: factors.map((f) => ({ key: f.key, score: Math.round(f.score) })) };
}

/** A rostered player's morale as his card shows it. */
export function moraleOf(state: LeagueState, ctx: SimContext, p: Player) {
  const mates = Object.values(state.players)
    .filter((x) => x.teamId === p.teamId && x.position === p.position)
    .sort(byOverall);
  const ask = ctx.models.contractDemand.ask(ctx.ruleset, p);
  return morale(p.id, {
    teamStatus: state.teamStatus[p.teamId!] ?? 'bubble',
    depthRank: mates.findIndex((x) => x.id === p.id),
    depth: ctx.ruleset.roster.positionMin[p.position] ?? 2,
    ...(p.contract && ask > 0 && { paidRatio: p.contract.capHit / ask }),
    seasons: p.joined === undefined ? 3 : Math.max(0, state.date.season - p.joined),
    wantsOut: state.tradeRequests.some((r) => r.playerId === p.id),
  });
}
