import type { Player, TeamId } from '@gm/shared';
import type { LeagueState } from './core';
import { chemistry } from './people';
import type { SimContext } from './context';

/** Whether a player sits out on `day`: hurt, or holding out. */
export const sitsOut = (state: LeagueState, p: Player, day: number): boolean =>
  (p.injuredUntil ?? 0) > day || state.holdouts.some((h) => h.playerId === p.id);

/** Who can play for a team on `day` (the game engine, the lines screen and exhibitions agree). */
export const available = (state: LeagueState, teamId: TeamId, day: number): Player[] =>
  Object.values(state.players).filter((p) => p.teamId === teamId && !sitsOut(state, p, day));

/**
 * A team's strength with these players, as the games play it: chemistry, the GM's lines and
 * units, and time together.
 */
export function strengthFor(
  state: LeagueState,
  ctx: SimContext,
  teamId: TeamId,
  players: readonly Player[],
): unknown {
  return ctx.sport.teamStrength(
    players,
    state.depthCharts[teamId],
    chemistry(players, state.date.season).value,
    state.specialUnits[teamId],
    state.linemates[teamId],
  );
}
