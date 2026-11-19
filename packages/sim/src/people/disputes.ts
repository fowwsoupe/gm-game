import type { Player, TeamId } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import { byOverall } from '../players';
import type { SimContext } from '../context';
import { moraleOf } from './morale';

/** Weekly chance an unhappy player goes to the GM about his role. */
const DISPUTE_CHANCE = 0.08;
/** He is unhappy when he sits this many places down his position's depth order from his rating's rank. */
const ROLE_GAP = 2;
/** Below this morale (0-100, as his card shows it) he is unhappy enough to complain. */
const LOW_MORALE = 45;
/** Days a promised role has to arrive (about 15 games). */
export const PROMISE_DAYS = 30;

/**
 * How many places further down his position's depth order a player sits than his rating ranks
 * him on his team (0 or less: where he expects to be). Players the GM has not placed come last,
 * best first; a team that never set its lines plays by rating, so nobody is short of a role.
 */
export function roleGap(state: LeagueState, teamId: TeamId, player: Player): number {
  const { byRating, depth } = depthOf(state, teamId, player);
  return depth.indexOf(player) - byRating.indexOf(player);
}

/** His position on his team best rating first, and its depth order: the GM's, then the rest by rating. */
function depthOf(state: LeagueState, teamId: TeamId, player: Player) {
  const group = Object.values(state.players).filter(
    (p) => p.teamId === teamId && p.position === player.position,
  );
  const byRating = [...group].sort(byOverall);
  const order = state.depthCharts[teamId] ?? [];
  const placed = order.flatMap((id) => group.filter((p) => p.id === id));
  return { byRating, depth: [...placed, ...byRating.filter((p) => !placed.includes(p))] };
}

/**
 * The pitch's promise comes due on day `PROMISE_DAYS` of his first regular season with the team
 * (`PROMISE_DAYS` after he signed, in season): not first at his position by then, he opens a
 * dispute at once and the disputes' own rules take over.
 */
function rolePromisesDue(state: LeagueState, emit: Emit): void {
  const { season, day } = state.date;
  for (const r of [...state.rolePromises]) {
    if (r.season > season || (r.season === season && day < r.day + PROMISE_DAYS)) continue;
    const p = state.players[r.playerId]!; // a player who leaves takes his promise with him
    const kept =
      !state.teams[r.teamId]?.userControlled || depthOf(state, r.teamId, p).depth[0] === p;
    emit('minor', [r.teamId], { kind: 'player.rolePromiseDue', playerId: p.id, kept });
    const upset = (x: { playerId: string }) => x.playerId === p.id;
    if (!kept && !state.disputes.some(upset) && !state.tradeRequests.some(upset)) {
      emit('notable', [r.teamId], {
        kind: 'player.disputeStarted',
        playerId: p.id,
        teamId: r.teamId,
      });
    }
  }
}

/**
 * Disputes (docs/research/2026-11-league-events.md), human teams only, once a week in the
 * regular season: a player in low spirits (his morale) who is kept well down the depth order for his
 * rating asks for more ice. One open dispute per team. A promised role that has not come by its day turns the
 * dispute into a trade request. AI teams' players settle it in the room, out of the news. A role
 * promised in free agency that has not come opens one (`rolePromisesDue`).
 */
export function disputesWeek(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  rolePromisesDue(state, emit);
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
      if (roleGap(state, team.id, p) < ROLE_GAP || moraleOf(state, ctx, p).value >= LOW_MORALE) {
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
