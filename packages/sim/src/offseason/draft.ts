import type { Player, TeamId } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import type { SimContext } from '../context';
import { entryContract, rosterOf } from './roster';

/**
 * Step 4: a fictional draft class, worst team picks first, best prospect (by potential) goes
 * first. Drafted players sign an entry-level contract; a pick the team cannot fit under the
 * cap is released into the free-agent pool instead.
 * TODO(feature): lottery, scouting uncertainty, draft rights and prospects kept off the roster.
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
  const count = order.length * ctx.ruleset.draft.rounds;
  const prospects = Array.from({ length: count }, (_, i) =>
    ctx.sport.generateProspect(rng, { id: `d${season}_${i}`, season }),
  ).sort((a, b) => b.potential - a.potential || a.id.localeCompare(b.id));

  prospects.forEach((prospect, i) => {
    const teamId = order[i % order.length]!;
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
