import type { Player, TeamId } from '@gm/shared';
import type { LeagueState } from './core';
import { chemistry, coachOf } from './people';
import type { SimContext } from './context';

/** Whether a player sits out on `day`: hurt, or holding out. */
export const sitsOut = (state: LeagueState, p: Player, day: number): boolean =>
  (p.injuredUntil ?? 0) > day || state.holdouts.some((h) => h.playerId === p.id);

/** Who can play for a team on `day` (the game engine, the lines screen and exhibitions agree). */
export const available = (state: LeagueState, teamId: TeamId, day: number): Player[] =>
  Object.values(state.players).filter((p) => p.teamId === teamId && !sitsOut(state, p, day));

/**
 * A team's strength with these players, as the games play it: chemistry, the GM's lines and
 * units, time together, the head coach (`frontOffice.coaching.points` either way at the
 * extremes, around an average coach of 0.5) and the team's form this season.
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
    coachingPoints(state, ctx, teamId) + (state.teamForm[teamId] ?? 0),
  );
}

function coachingPoints(state: LeagueState, ctx: SimContext, teamId: TeamId): number {
  const team = state.teams[teamId];
  if (!team) return 0;
  // ponytail: around a fixed 0.5 (coach quality is uniform); the league average if hiring tilts it.
  const q = coachOf(team, ctx.ruleset.finance.coach, state.date.season).quality ?? 0.5;
  return ctx.ruleset.frontOffice.coaching.points * 2 * (q - 0.5);
}
