import type { Dashboard, Player, TeamId, TodoItem } from '@gm/shared';
import { capYearOf, phaseOf, playerName, type LeagueState } from './core';
import { capYearIssues, teamCapTotal } from './cba';
import { freeAgents, isExpiring, resignOffers, resignWindowOpen, wantedYears } from './offseason';
import { assistantSees, departmentsOf, staffOf } from './people';
import { overall } from './players';
import { cachedContext } from './trades';
import { available, hurtOn } from './tonight';
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
  // A human GM's assistant adds advice, only as good as his read of the players
  // (docs/research/2026-11-assistant-gm.md). The human still decides.
  const team = state.teams[teamId];
  const assistant =
    team && departmentsOf(team).includes('assistant')
      ? staffOf(team, 'assistant', ruleset.frontOffice.salary, state.date.season)
      : undefined;
  const seen = (p: Player) => (assistant ? assistantSees(assistant, teamId, p) : p);

  // Extensions are optional in season; after the final it is now or never.
  const expiring = state.championTeamId ? resignOffers(state, ctx, teamId) : [];
  if (expiring.length > 0 && !state.freeAgencyOpen) {
    todo.push({ code: 'resign', params: { count: expiring.length }, screen: 'cap' });
    if (assistant) {
      const first = expiring
        .map((o) => state.players[o.playerId]!)
        .sort((a, b) => overall(seen(b)) - overall(seen(a)))[0]!;
      todo.push({ code: 'adviceResign', params: { player: playerName(first) }, screen: 'cap' });
    }
  }
  // A young player who broke out and is in his last year: his price only rises, so talk extension now.
  if (!state.championTeamId && resignWindowOpen(state, ctx)) {
    for (const p of roster.filter(
      (x) => state.breakouts[x.id] === state.date.season && isExpiring(state, x),
    )) {
      todo.push({ code: 'breakoutExtend', params: { player: playerName(p) }, screen: 'cap' });
    }
  }
  if (state.draftClass.length > 0 && !(state.draftBoards[teamId]?.length ?? 0)) {
    todo.push({ code: 'draftList', screen: 'draft' });
  }
  if (state.freeAgencyOpen) {
    todo.push({ code: 'freeAgency', screen: 'roster' });
    if (assistant) {
      // The free agent with the most surplus on a deal at his ask that fits the cap room, on his read.
      const room = ruleset.cap.upperLimit - teamCapTotal(state, teamId);
      const context = cachedContext(state, ctx, teamId);
      const season = capYearOf(state);
      const surplus = (p: Player, ask: number) =>
        ctx.models.valuation.value(
          seen({
            ...p,
            contract: {
              capHit: ask,
              expiresAfterSeason: season + wantedYears(season - p.birthYear) - 1,
            },
          }),
          context,
          ruleset,
        ).surplus;
      const best = freeAgents(state)
        .map((p) => ({ p, ask: ctx.models.contractDemand.ask(ruleset, p) }))
        .filter((x) => x.ask <= room)
        .map((x) => ({ p: x.p, value: surplus(x.p, x.ask) }))
        .sort((a, b) => b.value - a.value || a.p.id.localeCompare(b.p.id))[0];
      if (best && best.value > 0) {
        todo.push({ code: 'adviceSign', params: { player: playerName(best.p) }, screen: 'roster' });
      }
    }
  }
  for (const r of state.tradeRequests.filter((x) => x.teamId === teamId)) {
    const p = state.players[r.playerId];
    if (p) {
      todo.push({
        code: 'tradeRequest',
        params: { player: playerName(p) },
        screen: 'trades',
      });
    }
  }
  for (const d of state.disputes.filter(
    (x) => x.teamId === teamId && x.until === undefined && !x.listed,
  )) {
    const p = state.players[d.playerId];
    if (p) todo.push({ code: 'dispute', params: { player: playerName(p) }, screen: 'lines' });
  }
  for (const h of state.holdouts.filter((x) => x.teamId === teamId)) {
    const p = state.players[h.playerId];
    if (p) {
      todo.push({
        code: 'holdout',
        params: { player: playerName(p) },
        screen: 'roster',
      });
    }
  }
  const offers = state.tradeOffers.filter((o) => o.proposal.toTeamId === teamId);
  if (offers.length > 0) {
    todo.push({ code: 'tradeOffers', params: { count: offers.length }, screen: 'trades' });
  }
  if (assistant && offers.length > 0) {
    const context = cachedContext(state, ctx, teamId);
    const players = (ids: readonly string[]) => ids.flatMap((id) => state.players[id] ?? []);
    // ponytail: players only; AI offers carry no picks yet (add pickValue when they do).
    const worth = (ids: readonly string[]) =>
      players(ids).reduce(
        (sum, p) => sum + ctx.models.valuation.value(seen(p), context, ruleset).surplus,
        0,
      );
    const names = (ids: readonly string[]) => players(ids).map(playerName).join(', ');
    for (const { proposal } of offers) {
      todo.push({
        code: worth(proposal.give) > worth(proposal.get) ? 'adviceTake' : 'adviceDecline',
        params: { give: names(proposal.give), get: names(proposal.get) },
        screen: 'trades',
      });
    }
  }
  const hurt = roster.filter((p) => hurtOn(p, state.date.day)).length;
  if (hurt > 0) todo.push({ code: 'injured', params: { count: hurt }, screen: 'roster' });
  if (assistant && state.depthCharts[teamId]?.length) {
    // Only once you set your own order (the coach's default one needs no second opinion): the
    // healthy player who beats a top-line player of his position by the most, on his read
    // (the first unit of the lineup the game would dress).
    const healthy = available(state, teamId, state.date.day);
    const top = new Set(ctx.sport.lineup(healthy, state.depthCharts[teamId])[0]?.playerIds);
    const bench = healthy.filter((p) => !top.has(p.id));
    let best: { p: Player; gain: number } | undefined;
    for (const t of healthy.filter((p) => top.has(p.id))) {
      for (const c of bench.filter((p) => p.position === t.position)) {
        const gain = overall(seen(c)) - overall(seen(t));
        if (gain > (best?.gain ?? 0)) best = { p: c, gain };
      }
    }
    if (best) {
      todo.push({ code: 'adviceLines', params: { player: playerName(best.p) }, screen: 'lines' });
    }
  }
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
    ownerCards: state.ownerCards.filter((c) => c.teamId === teamId),
    nextGame: next
      ? {
          opponentId: next.homeTeamId === teamId ? next.awayTeamId : next.homeTeamId,
          home: next.homeTeamId === teamId,
          day: next.date.day,
        }
      : null,
  };
}
