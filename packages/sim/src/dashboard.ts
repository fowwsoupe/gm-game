import type { Dashboard, TeamId, TodoItem } from '@gm/shared';
import { phaseOf, type LeagueState } from './core';
import { capYearIssues, teamCapTotal } from './cba';
import { resignOffers } from './offseason';
import type { SimContext } from './context';

/** Days before the trade deadline when Home starts reminding you. */
const DEADLINE_WARNING_DAYS = 14;

/**
 * Home for one team: what needs a decision now (clears to zero when nothing does) and the next
 * game. Every item comes from the rules, so the list cannot drift from what the sim enforces.
 */
export function dashboard(state: LeagueState, ctx: SimContext, teamId: TeamId): Dashboard {
  const { ruleset } = ctx;
  const cal = ruleset.season.calendar;
  const roster = Object.values(state.players).filter((p) => p.teamId === teamId);
  const todo: TodoItem[] = [];

  // Extensions are optional in season; after the final it is now or never.
  const expiring = state.championTeamId ? resignOffers(state, ctx, teamId).length : 0;
  if (expiring > 0 && !state.freeAgencyOpen) {
    todo.push({ code: 'resign', params: { count: expiring }, screen: 'cap' });
  }
  if (state.draftClass.length > 0 && !(state.draftBoards[teamId]?.length ?? 0)) {
    todo.push({ code: 'draftList', screen: 'draft' });
  }
  if (state.freeAgencyOpen) todo.push({ code: 'freeAgency', screen: 'roster' });
  const hurt = roster.filter((p) => (p.injuredUntil ?? 0) > state.date.day).length;
  if (hurt > 0) todo.push({ code: 'injured', params: { count: hurt }, screen: 'roster' });
  for (const [position, min] of Object.entries(ruleset.roster.positionMin)) {
    const have = roster.filter((p) => p.position === position).length;
    if (have < min) {
      todo.push({ code: 'rosterShort', params: { position, count: min - have }, screen: 'roster' });
    }
  }
  const over = capYearIssues(ruleset, state, teamCapTotal(state, teamId)).find(
    (i) => i.code !== 'below_floor',
  );
  if (over && 'over' in over)
    todo.push({ code: 'overCap', params: { amount: over.over }, screen: 'cap' });
  const toDeadline = cal.tradeDeadlineDay - state.date.day;
  if (
    phaseOf(cal, state.date) === 'regular' &&
    toDeadline >= 0 &&
    toDeadline <= DEADLINE_WARNING_DAYS
  ) {
    todo.push({ code: 'deadline', params: { days: toDeadline }, screen: 'trades' });
  }

  const played = new Set<string>(Object.keys(state.results));
  const next = state.schedule
    .filter(
      (g) =>
        g.date.season === state.date.season &&
        !played.has(g.id) &&
        (g.homeTeamId === teamId || g.awayTeamId === teamId),
    )
    .sort((a, b) => a.date.day - b.date.day)[0];
  return {
    todo,
    nextGame: next
      ? {
          opponentId: next.homeTeamId === teamId ? next.awayTeamId : next.homeTeamId,
          home: next.homeTeamId === teamId,
          day: next.date.day,
        }
      : null,
  };
}
