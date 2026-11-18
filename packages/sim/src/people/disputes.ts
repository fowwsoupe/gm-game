import type { Player, TeamId } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import { byOverall } from '../players';
import { personalityOf } from './personality';

/** Weekly chance an unhappy, ambitious player goes to the GM about his role. */
const DISPUTE_CHANCE = 0.08;
/** He is unhappy when he sits this many places down his position's depth order from his rating's rank. */
const ROLE_GAP = 2;
const AMBITIOUS = 0.6;
/** Days a promised role has to arrive (about 15 games). */
export const PROMISE_DAYS = 30;

/**
 * How many places further down his position's depth order a player sits than his rating ranks
 * him on his team (0 or less: where he expects to be). Players the GM has not placed come last,
 * best first; a team that never set its lines plays by rating, so nobody is short of a role.
 */
export function roleGap(state: LeagueState, teamId: TeamId, player: Player): number {
  const group = Object.values(state.players).filter(
    (p) => p.teamId === teamId && p.position === player.position,
  );
  const byRating = [...group].sort(byOverall);
  const order = state.depthCharts[teamId] ?? [];
  const placed = order.flatMap((id) => group.filter((p) => p.id === id));
  const depth = [...placed, ...byRating.filter((p) => !placed.includes(p))];
  return depth.indexOf(player) - byRating.indexOf(player);
}

/**
 * Disputes (docs/research/2026-11-league-events.md), human teams only, once a week in the
 * regular season: an ambitious player kept well down the depth order for his rating asks for
 * more ice. One open dispute per team. A promised role that has not come by its day turns the
 * dispute into a trade request. AI teams' players settle it in the room, out of the news.
 */
export function disputesWeek(state: LeagueState, rng: Rng, emit: Emit): void {
  const day = state.date.day;
  for (const d of [...state.disputes]) {
    const p = state.players[d.playerId];
    if (!p || p.teamId !== d.teamId) continue;
    // Listed and then taken off the block: he asks out. Still listed: it waits for a trade.
    const unlisted = d.listed && !state.tradeBlock.includes(p.id);
    if (!unlisted && (d.until === undefined || d.until > day)) continue;
    const kept = !unlisted && roleGap(state, d.teamId, p) < ROLE_GAP;
    emit('notable', [d.teamId], {
      kind: 'player.disputeEnded',
      playerId: p.id,
      outcome: kept ? 'kept' : 'request',
    });
    if (!kept && !state.tradeRequests.some((r) => r.playerId === p.id)) {
      emit('major', [d.teamId], {
        kind: 'player.tradeRequested',
        playerId: p.id,
        teamId: d.teamId,
      });
    }
  }
  for (const team of Object.values(state.teams).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!team.userControlled || state.disputes.some((d) => d.teamId === team.id)) continue;
    const roster = Object.values(state.players)
      .filter((p) => p.teamId === team.id)
      .sort(byOverall);
    for (const p of roster) {
      // Always draw, so one player's mood never shifts another's.
      const asks = rng.chance(DISPUTE_CHANCE);
      if (personalityOf(p.id).ambition < AMBITIOUS || roleGap(state, team.id, p) < ROLE_GAP) {
        continue;
      }
      if (state.tradeRequests.some((r) => r.playerId === p.id) || !asks) continue;
      emit('notable', [team.id], {
        kind: 'player.disputeStarted',
        playerId: p.id,
        teamId: team.id,
      });
      break;
    }
  }
}
