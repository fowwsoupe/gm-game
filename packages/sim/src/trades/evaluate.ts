import type {
  Player,
  Prospect,
  RetainedSalary,
  TeamId,
  TradeEvaluation,
  TradeProposal,
  TradeReason,
} from '@gm/shared';
import { pct, phaseOf, playerName, type LeagueState } from '../core';
import {
  capYearIssues,
  capYearOf,
  prospectDeal,
  retentionIssues,
  teamCapTotal,
  type Ruleset,
} from '../cba';
import { pickValue, type TeamContext } from '../value';
import { draftPicks, nextDraftSeason, worstFirst } from '../league';
import {
  GM_LEAN,
  assistantSees,
  departmentsOf,
  gmOf,
  planStatus,
  seenBy,
  staffOf,
} from '../people';
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
/** A first-round pick that projects inside its top-N protection is worth this share to the receiver. */
const PROTECTED_SHARE = 0.25;

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

/** A prospect as trades value him: on the entry deal he would sign for `season`. */
export function signedProspect(rules: Ruleset, pr: Prospect, season: number): Player {
  const contract = prospectDeal(rules, pr, season);
  return contract ? { ...pr.player, contract } : pr.player;
}

/**
 * The salary `fromTeamId` keeps on players it gives (`proposal.retain`), checked against the
 * ruleset: at most the max share, the max number of retained contracts, and no retaining a
 * contract that already carries retained salary (ponytail: the cooldown is treated as the whole
 * contract; track the retention day if a shorter cooldown matters). It charges each season left
 * on the deal in full, the current one included (no proration yet).
 */
export function planRetention(
  state: LeagueState,
  ctx: SimContext,
  proposal: TradeProposal,
): { retained: RetainedSalary[] } | { error: TradeReason } {
  const season = capYearOf(state);
  const retainedNow = (teamId: TeamId) =>
    new Set(
      state.capCharges
        .filter((c) => c.kind === 'retained' && c.teamId === teamId && c.season >= season)
        .map((c) => c.playerId),
    ).size;
  const retained: RetainedSalary[] = [];
  for (const { playerId, pct: share } of proposal.retain ?? []) {
    const p = state.players[playerId];
    const contract = p?.contract;
    const name = p ? playerName(p) : playerId;
    const { maxRetentionPct: max, maxRetainedContracts: contracts } = ctx.ruleset.trades;
    const fail = {
      error: { code: 'retention' as const, params: { player: name, max, contracts } },
    };
    if (!p || !contract || !proposal.give.includes(p.id) || contract.expiresAfterSeason < season) {
      return fail;
    }
    // Listing a player twice would retain past the max share.
    if (!Number.isInteger(share) || share <= 0 || retained.some((r) => r.playerId === p.id)) {
      return fail;
    }
    const before = state.capCharges.some((c) => c.kind === 'retained' && c.playerId === p.id);
    const issues = retentionIssues(ctx.ruleset, {
      retainPct: share,
      teamRetainedCount: retainedNow(proposal.fromTeamId) + retained.length,
      daysSinceRetained: before ? 0 : null,
    });
    if (issues.length) return fail;
    const amount = Math.round((contract.capHit * share) / 100);
    retained.push({
      playerId: p.id,
      capHit: contract.capHit - amount,
      charges: Array.from({ length: contract.expiresAfterSeason - season + 1 }, (_, i) => ({
        teamId: proposal.fromTeamId,
        playerId: p.id,
        kind: 'retained' as const,
        season: season + i,
        amount,
      })),
    });
  }
  return { retained };
}

/** What `teamId` knows about itself when it values players (see the value engine). */
function teamContext(state: LeagueState, ctx: SimContext, teamId: TeamId): TeamContext {
  const { ruleset } = ctx;
  const players = Object.values(state.players).filter((p) => p.teamId === teamId);
  const days = ruleset.season.calendar.regularSeasonDays;
  const inSeason = !state.championTeamId && state.date.day >= 0;
  return {
    status: planStatus(state.teams[teamId]!, state.teamStatus[teamId] ?? 'bubble'),
    season: capYearOf(state),
    seasonLeft: inSeason ? Math.max(0, 1 - state.date.day / days) : 1,
    needs: Object.entries(ruleset.roster.positionMin)
      .filter(([position, min]) => count(players, teamId, position) < min)
      .map(([position]) => position),
    lean: state.teams[teamId]?.userControlled ? 0 : GM_LEAN[gmOf(state.teams[teamId]!).style],
  };
}

/**
 * Work that stays the same while the league does not change, shared by many evaluations (one
 * week of AI trade talks). Start a new one after any trade.
 */
export interface TradeCache {
  contexts: Map<TeamId, TeamContext>;
  worstFirst?: TeamId[];
}
export const newTradeCache = (): TradeCache => ({ contexts: new Map() });

/** A team's context, from the cache when there is one. */
export function cachedContext(
  state: LeagueState,
  ctx: SimContext,
  teamId: TeamId,
  cache?: TradeCache,
): TeamContext {
  let team = cache?.contexts.get(teamId);
  if (!team) {
    team = teamContext(state, ctx, teamId);
    cache?.contexts.set(teamId, team);
  }
  return team;
}

/**
 * Whether `toTeamId` accepts the trade. Legal first (window, ownership, cap ceiling, the other
 * team keeping its position minimums), then value: the players it receives, best first and
 * discounted for depth, minus the ones it sends, must beat a small margin. A user-controlled
 * partner accepts any legal trade (`trade.propose` lets only its own GM propose one).
 */
export function evaluateTrade(
  state: LeagueState,
  ctx: SimContext,
  proposal: TradeProposal,
  cache?: TradeCache,
  /** How the other team sees a player (default: its own GM's read). */
  see: (p: Player) => Player = (p) => seenBy(state.teams[proposal.toTeamId]!, p),
): TradeEvaluation {
  const { ruleset } = ctx;
  const { fromTeamId: from, toTeamId: to, give, get } = proposal;
  const refuse = (code: TradeReason['code'], params?: TradeReason['params']) => ({
    accepted: false,
    value: 0,
    reasons: [{ code, ...(params && { params }) }],
  });

  if (!tradeWindowOpen(state, ctx)) return refuse('closed');
  if (from === to || !state.teams[from] || !state.teams[to]) return refuse('not_on_team');
  const givePicks = proposal.givePicks ?? [];
  const getPicks = proposal.getPicks ?? [];
  const giveProspects = proposal.giveProspects ?? [];
  const getProspects = proposal.getProspects ?? [];
  const protectTop = proposal.protectTop ?? 0;
  if (!Number.isInteger(protectTop) || protectTop < 0) return refuse('empty');
  const assets = [...give, ...get, ...givePicks, ...getPicks, ...giveProspects, ...getProspects];
  if (assets.length === 0 || new Set(assets).size !== assets.length) return refuse('empty');
  // Built only when picks are in the deal (AI trade talks call this hundreds of times a week).
  const picks = new Map(
    givePicks.length + getPicks.length > 0 ? draftPicks(state, ruleset).map((p) => [p.id, p]) : [],
  );
  const label = (id: string) => {
    const p = picks.get(id);
    return p ? `${p.season} R${p.round} ${state.teams[p.originalTeamId]?.abbreviation ?? ''}` : id;
  };
  for (const [ids, owner] of [
    [givePicks, from],
    [getPicks, to],
  ] as const) {
    for (const id of ids) {
      const pick = picks.get(id);
      if (!pick) return refuse('pick', { pick: id });
      if (pick.ownerTeamId !== owner) return refuse('not_your_pick', { pick: label(id) });
    }
  }
  const player = (id: Player['id']) => state.players[id];
  const prospect = (id: Player['id']) => state.prospects[id]?.player;
  for (const [ids, owner, find] of [
    [give, from, player],
    [get, to, player],
    [giveProspects, from, prospect],
    [getProspects, to, prospect],
  ] as const) {
    for (const id of ids) {
      const p = find(id);
      if (p?.teamId !== owner) return refuse('not_on_team', { player: p ? playerName(p) : id });
      if (p.contract?.noTrade) return refuse('no_trade', { player: playerName(p) });
    }
  }

  const plan = planRetention(state, ctx, proposal);
  if ('error' in plan) return { accepted: false, value: 0, reasons: [plan.error] };
  const kept = new Map(plan.retained.map((r) => [r.playerId as string, r]));
  const season = capYearOf(state);
  // Only the two teams' players matter for their cap, positions and the players' values.
  const before = Object.values(state.players).filter((p) => p.teamId === from || p.teamId === to);
  const after = before.map((p) => {
    const r = kept.get(p.id);
    const moved = give.includes(p.id)
      ? { ...p, teamId: to }
      : get.includes(p.id)
        ? { ...p, teamId: from }
        : p;
    return r && p.contract ? { ...moved, contract: { ...p.contract, capHit: r.capHit } } : moved;
  });
  const newCharges = plan.retained
    .flatMap((r) => r.charges)
    .filter((c) => c.season === season)
    .reduce((sum, c) => sum + c.amount, 0);
  for (const teamId of [from, to]) {
    const total = teamCapTotal(state, teamId, after) + (teamId === from ? newCharges : 0);
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

  const team = cachedContext(state, ctx, to, cache);
  const afterById = new Map(after.map((p) => [p.id as string, p]));
  // Incoming players are valued at their cap hit after any retention.
  const valueOf = (id: string) => {
    const p = afterById.get(id)!;
    return { p, ...ctx.models.valuation.value(see(p), team, ruleset) };
  };
  // Prospects are off the cap and the roster: only their value counts.
  const prospectOf = (id: Player['id']) => {
    const p = signedProspect(ruleset, state.prospects[id]!, team.season);
    return { p, ...ctx.models.valuation.value(see(p), team, ruleset) };
  };
  // A pick in the next draft lands where its original team finishes (worst first, from today's
  // standings), trusted more as the season is played: an empty table is all ties broken by team
  // id. Later drafts are guessed at the middle of the round.
  const teamCount = Object.keys(state.teams).length;
  const middle = Math.ceil(teamCount / 2);
  const played = state.championTeamId
    ? 1
    : Math.min(1, Math.max(0, state.date.day / ruleset.season.calendar.regularSeasonDays));
  // Only needed to value picks, and costly (every result this season): computed on first use.
  const slotOf = (teamId: TeamId) => {
    const order = (cache ?? {}) as { worstFirst?: TeamId[] };
    order.worstFirst ??= worstFirst(state, ruleset);
    return order.worstFirst.indexOf(teamId) + 1;
  };
  const next = nextDraftSeason(state);
  const pickOf = (id: string, protectedTop = 0) => {
    const pick = picks.get(id)!;
    // Once the lottery is drawn, a round-one pick in the next draft has its real slot.
    const drawn =
      pick.season === next && pick.round === 1 ? state.draftOrder.indexOf(pick.originalTeamId) : -1;
    const slot =
      drawn >= 0
        ? drawn + 1
        : pick.season === next && played > 0
          ? Math.round(middle + (slotOf(pick.originalTeamId) - middle) * played)
          : middle;
    return {
      p: undefined,
      label: label(id),
      // Protected picks that project inside the protection are worth little to the receiver.
      surplus: Math.round(
        pickValue(
          ruleset,
          { slot, teams: teamCount, round: pick.round, yearsAway: pick.season - next },
          team.status,
        ) * (pick.round === 1 && slot <= protectedTop ? PROTECTED_SHARE : 1),
      ),
      reasons: [] as const,
    };
  };
  const incoming = [
    ...give.map(valueOf),
    ...giveProspects.map(prospectOf),
    ...givePicks.map((id) => pickOf(id, protectTop)),
  ].sort((a, b) => b.surplus - a.surplus);
  const outgoing = [...get.map(valueOf), ...getProspects.map(prospectOf), ...getPicks.map(pickOf)];
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
    if (!v.p) continue;
    for (const r of v.reasons) {
      const code = r === 'negative_contract' ? 'bad_contract' : r;
      reasons.push({ code, params: { player: playerName(v.p) } });
    }
  }
  return { accepted, value, reasons: reasons.slice(0, MAX_REASONS) };
}

/**
 * A human team's assistant GM's guess at the other team's answer (true: likely yes): the same
 * evaluation, but with every player as the assistant reads him instead of the other GM, so a
 * poor assistant is wrong more often (docs/research/2026-11-assistant-gm.md). Undefined when
 * the proposer is an AI team or has no assistant.
 */
export function assistantGuess(
  state: LeagueState,
  ctx: SimContext,
  proposal: TradeProposal,
): boolean | undefined {
  const team = state.teams[proposal.fromTeamId];
  if (!team?.userControlled || !departmentsOf(team).includes('assistant')) return undefined;
  const head = staffOf(team, 'assistant', ctx.ruleset.frontOffice.salary, state.date.season);
  return evaluateTrade(state, ctx, proposal, undefined, (p) => assistantSees(head, team.id, p))
    .accepted;
}
