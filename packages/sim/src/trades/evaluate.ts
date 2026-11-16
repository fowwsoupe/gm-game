import type { Player, TeamId, TradeEvaluation, TradeProposal, TradeReason } from '@gm/shared';
import { pct, phaseOf, type LeagueState } from '../core';
import { capYearIssues, capYearOf, teamCapTotal } from '../cba';
import type { TeamContext } from '../value';
import type { SimContext } from '../context';

/** The other team wants to win a trade by at least this share of the cap. */
const MARGIN_PCT_OF_CAP = 0.5;
/**
 * Each extra player coming in is worth less than the one before: weight 1 / (1 + k·i) for the
 * i-th best. Stops three average players buying a star. Players with negative value are never
 * discounted, so dumping a bad contract always costs full price.
 */
const DEPTH_DISCOUNT = 0.5;
/** Reasons quoted at most. */
const MAX_REASONS = 4;

/** Trades are open in the preseason, the regular season up to the deadline, and once the champion is crowned. */
export function tradeWindowOpen(state: LeagueState, ctx: SimContext): boolean {
  const cal = ctx.ruleset.season.calendar;
  const phase = phaseOf(cal, state.date);
  return (
    state.championTeamId !== null ||
    phase === 'preseason' ||
    (phase === 'regular' && state.date.day <= cal.tradeDeadlineDay)
  );
}

const count = (players: readonly Player[], teamId: TeamId, position: string) =>
  players.filter((p) => p.teamId === teamId && p.position === position).length;

/** What `teamId` knows about itself when it values players (see the value engine). */
export function teamContext(state: LeagueState, ctx: SimContext, teamId: TeamId): TeamContext {
  const { ruleset } = ctx;
  const players = Object.values(state.players);
  const days = ruleset.season.calendar.regularSeasonDays;
  const inSeason = !state.championTeamId && state.date.day >= 0;
  return {
    status: state.teamStatus[teamId] ?? 'bubble',
    season: capYearOf(state),
    seasonLeft: inSeason ? Math.max(0, 1 - state.date.day / days) : 1,
    capSpace: ruleset.cap.upperLimit - teamCapTotal(state, teamId, players),
    needs: Object.entries(ruleset.roster.positionMin)
      .filter(([position, min]) => count(players, teamId, position) < min)
      .map(([position]) => position),
  };
}

/**
 * Whether `toTeamId` accepts the trade. Legal first (window, ownership, cap ceiling, the other
 * team keeping its position minimums), then value: the players it receives, best first and
 * discounted for depth, minus the ones it sends, must beat a small margin. A user-controlled
 * partner accepts any legal trade (the same person runs both teams).
 */
export function evaluateTrade(
  state: LeagueState,
  ctx: SimContext,
  proposal: TradeProposal,
): TradeEvaluation {
  const { ruleset } = ctx;
  const { fromTeamId: from, toTeamId: to, give, get } = proposal;
  const refuse = (code: TradeReason['code'], params?: TradeReason['params']) => ({
    accepted: false,
    value: 0,
    reasons: [{ code, ...(params && { params }) }],
  });
  const name = (p: Player) => `${p.firstName} ${p.lastName}`;

  if (!tradeWindowOpen(state, ctx)) return refuse('closed');
  if (from === to || !state.teams[from] || !state.teams[to]) return refuse('not_on_team');
  if (
    give.length + get.length === 0 ||
    new Set([...give, ...get]).size !== give.length + get.length
  ) {
    return refuse('empty');
  }
  for (const [ids, owner] of [
    [give, from],
    [get, to],
  ] as const) {
    for (const id of ids) {
      const p = state.players[id];
      if (p?.teamId !== owner) return refuse('not_on_team', { player: p ? name(p) : id });
    }
  }

  const before = Object.values(state.players);
  const after = before.map((p) =>
    give.includes(p.id) ? { ...p, teamId: to } : get.includes(p.id) ? { ...p, teamId: from } : p,
  );
  for (const teamId of [from, to]) {
    const total = teamCapTotal(state, teamId, after);
    if (
      capYearIssues(ruleset, state, total).length &&
      total > teamCapTotal(state, teamId, before)
    ) {
      return refuse('over_cap', { team: state.teams[teamId]!.abbreviation });
    }
  }
  for (const [position, min] of Object.entries(ruleset.roster.positionMin)) {
    const left = count(after, to, position);
    if (left < min && left < count(before, to, position)) return refuse('short_at', { position });
  }

  if (state.teams[to]!.userControlled) {
    return { accepted: true, value: 0, reasons: [{ code: 'accepted' }] };
  }

  const team = teamContext(state, ctx, to);
  const valueOf = (id: string) => {
    const p = state.players[id]!;
    return { p, ...ctx.models.valuation.value(p, team, ruleset) };
  };
  const incoming = give.map(valueOf).sort((a, b) => b.surplus - a.surplus);
  const outgoing = get.map(valueOf);
  let rank = 0;
  let received = 0;
  let positive = 0;
  let lostToDepth = 0;
  for (const v of incoming) {
    const counted = v.surplus > 0 ? v.surplus / (1 + DEPTH_DISCOUNT * rank++) : v.surplus;
    received += counted;
    if (v.surplus > 0) positive += v.surplus;
    lostToDepth += v.surplus - counted;
  }
  const value = Math.round(received - outgoing.reduce((sum, v) => sum + v.surplus, 0));
  const margin = pct(ruleset.cap.upperLimit, MARGIN_PCT_OF_CAP);
  const accepted = value >= margin;

  const reasons: TradeReason[] = [];
  if (accepted) reasons.push({ code: 'accepted' });
  else reasons.push({ code: 'value_short', params: { amount: margin - value } });
  if (!accepted && lostToDepth > positive / 4) reasons.push({ code: 'quantity' });
  for (const v of incoming) {
    for (const r of v.reasons) {
      const code = r === 'negative_contract' ? 'bad_contract' : r;
      reasons.push({ code, params: { player: name(v.p) } });
    }
  }
  return { accepted, value, reasons: reasons.slice(0, MAX_REASONS) };
}
