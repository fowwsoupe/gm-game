import type { Player, TeamId } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import type { SimContext } from '../context';
import { entryContract, rosterOf } from './roster';

/**
 * Step 4: a fictional draft class, worst team picks first, best prospect (by potential) goes
 * first. Drafted players sign an entry-level contract; a pick the team cannot fit under the
 * cap is released into the free-agent pool instead.
 * Round one follows the lottery; later rounds go worst to best.
 * TODO(feature): scouting uncertainty, draft rights and prospects kept off the roster.
 */
export function runDraft(
  state: LeagueState,
  ctx: SimContext,
  rng: Rng,
  emit: Emit,
  season: number,
  /** Teams from worst to best. */
  order: readonly TeamId[],
) {
  const { lottery } = ctx.ruleset.draft;
  const firstRound = lotteryOrder(
    order,
    lottery,
    order.length - ctx.ruleset.playoffs.teamsQualifying,
    rng.fork('lottery'),
  );
  if (lottery && firstRound[0] !== order[0] && firstRound[0]) {
    const team = state.teams[firstRound[0]]!;
    emit('notable', [team.id], {
      kind: 'news.posted',
      headline: 'event.lotteryWon',
      params: { team: `${team.city} ${team.name}` },
    });
  }
  const count = order.length * ctx.ruleset.draft.rounds;
  const prospects = Array.from({ length: count }, (_, i) =>
    ctx.sport.generateProspect(rng, { id: `d${season}_${i}`, season }),
  ).sort((a, b) => b.potential - a.potential || a.id.localeCompare(b.id));

  prospects.forEach((prospect, i) => {
    const teamId = (i < order.length ? firstRound : order)[i % order.length]!;
    const contract = entryContract(ctx.ruleset, rosterOf(state, teamId), prospect, season);
    const player: Player = contract ? { ...prospect, teamId, contract } : prospect;
    emit('minor', [teamId], {
      kind: 'player.drafted',
      player,
      round: Math.floor(i / order.length) + 1,
      pick: i + 1,
    });
  });
}

/**
 * Round-one order: the worst `poolSize` teams (at most one per entry in the odds) hold a lottery;
 * each draw picks one at random, weighted by its odds, to pick next. Everyone else keeps their place.
 */
export function lotteryOrder(
  order: readonly TeamId[],
  rule: { draws: number; odds: readonly number[] } | null,
  poolSize: number,
  rng: Rng,
): TeamId[] {
  if (!rule) return [...order];
  const pool = order
    .slice(0, Math.max(0, Math.min(poolSize, rule.odds.length)))
    .map((id, i) => ({ id, weight: rule.odds[i]! }));
  const winners: TeamId[] = [];
  for (let d = 0; d < rule.draws && pool.length > 0; d++) {
    let roll = rng.next() * pool.reduce((sum, t) => sum + t.weight, 0);
    const at = Math.max(
      0,
      pool.findIndex((t) => (roll -= t.weight) < 0),
    );
    winners.push(pool.splice(at, 1)[0]!.id);
  }
  return [...winners, ...pool.map((t) => t.id), ...order.slice(winners.length + pool.length)];
}
