/**
 * Owner & finance engine.
 * Owns: each team's money. Revenue and costs settle once a month (`finance.settled`), with one
 * more settlement for the playoffs; the reducer adds the difference to `state.cash`.
 * Later: fan interest and ticket pricing, budgets, projects, owner objectives.
 */
import type { FinanceLines, PlayerId, TeamId } from '@gm/shared';
import type { Emit, LeagueState } from '../core';
import { contractIn, type Ruleset } from '../cba';
import { marketOf } from '../people';
import type { SimContext } from '../context';

/** Days in a settlement month. */
export const MONTH_DAYS = 30;

/** Whether the books settle at the start of `day`: each month of the regular season, and at its end. */
export const settlesOn = (day: number, regularDays: number) =>
  day >= 0 && day <= regularDays && (day % MONTH_DAYS === 0 || day === regularDays);

/**
 * The part of a yearly `amount` that falls in regular-season days [from, to). Rounded on the
 * running total, so the months of a season add up to exactly `amount`.
 */
const slice = (amount: number, from: number, to: number, days: number) =>
  Math.round((amount * to) / days) - Math.round((amount * from) / days);

const empty = (): FinanceLines => ({
  revenue: { gate: 0, gameDay: 0, sponsorship: 0, media: 0, leagueShare: 0, playoffs: 0 },
  costs: { salaries: 0, signingBonuses: 0, performanceBonuses: 0, deadCap: 0, operations: 0 },
});

/** A home date's operating cost: like its ticket prices, higher in a bigger market. */
const dateCost = (f: Ruleset['finance'], market: number) => f.operations.perHomeDate * market;

/** A settlement's revenue less its costs. */
export const net = (l: FinanceLines) =>
  Object.values(l.revenue).reduce((a, b) => a + b, 0) -
  Object.values(l.costs).reduce((a, b) => a + b, 0);

/**
 * Settles the regular-season month that ends as `day` starts (see `settlesOn`). Day 0 pays each
 * contract's signing bonus. Payroll, dead cap and the yearly lines are spread over the regular
 * season's days; gate and operations follow the home dates played.
 * ponytail: payroll is read from today's rosters, so a player traded mid-month is paid by his new
 * team for the whole month. Track days on each roster if the money-flow chart needs it.
 */
export function settleMonth(state: LeagueState, ctx: SimContext, emit: Emit, day: number): void {
  const f = ctx.ruleset.finance;
  const days = ctx.ruleset.season.calendar.regularSeasonDays;
  const season = state.date.season;
  const to = Math.min(day, days);
  const from = Math.max(0, day % MONTH_DAYS === 0 ? day - MONTH_DAYS : day - (day % MONTH_DAYS));
  const yearly = (amount: number) => slice(amount, from, to, days);
  const homeDates = new Map<TeamId, number>();
  for (const g of state.schedule) {
    if (g.date.season === season && g.date.day >= from && g.date.day < to) {
      homeDates.set(g.homeTeamId, (homeDates.get(g.homeTeamId) ?? 0) + 1);
    }
  }
  const books = new Map(Object.keys(state.teams).map((id) => [id as TeamId, empty()]));
  for (const p of Object.values(state.players)) {
    const c = p.teamId ? contractIn(p, season) : undefined;
    const lines = p.teamId && books.get(p.teamId);
    if (!c || !lines) continue;
    lines.costs.salaries += yearly(c.capHit - (c.bonus ?? 0));
    if (day === 0) lines.costs.signingBonuses += c.bonus ?? 0;
  }
  for (const c of state.capCharges) {
    // Bonus overage is cap only: the bonus itself was paid in cash when earned.
    if (c.season === season && c.kind !== 'bonusOverage') {
      const lines = books.get(c.teamId);
      if (lines) lines.costs.deadCap += yearly(c.amount);
    }
  }
  for (const [teamId, lines] of [...books].sort(([a], [b]) => a.localeCompare(b))) {
    const market = marketOf(state.teams[teamId]!);
    const fans = f.fansPerDate * (homeDates.get(teamId) ?? 0);
    const r = lines.revenue;
    r.gate = Math.round(fans * f.ticketPrice * market);
    r.gameDay = Math.round(fans * f.gameDaySpend * market);
    r.sponsorship = yearly(Math.round(f.sponsorship * market));
    r.media = yearly(Math.round(f.localMedia * market));
    r.leagueShare = yearly(f.leagueShare);
    lines.costs.operations =
      yearly(f.operations.yearly) + Math.round(dateCost(f, market) * (homeDates.get(teamId) ?? 0));
    emit('minor', [teamId], { kind: 'finance.settled', teamId, ...lines });
  }
}

/**
 * Settles the playoffs once the champion is known: each home date's gate at the playoff markup,
 * less the players' share and the league's fee, game-day spend, the dates' operations, and the
 * performance bonuses just `paid`.
 */
export function settlePlayoffs(
  state: LeagueState,
  ctx: SimContext,
  emit: Emit,
  paid: readonly { playerId: PlayerId; teamId: TeamId; amount: number }[],
): void {
  const f = ctx.ruleset.finance;
  const { markupPct, playersPct, feePerDate } = f.playoffs;
  for (const teamId of (Object.keys(state.teams) as TeamId[]).sort()) {
    const lines = empty();
    const dates = Object.values(state.results).filter(
      (g) => g.playoffSeriesId && g.homeTeamId === teamId,
    ).length;
    const market = marketOf(state.teams[teamId]!);
    const gate = f.fansPerDate * f.ticketPrice * market * (1 + markupPct / 100);
    lines.revenue.playoffs = Math.round(dates * (gate * (1 - playersPct / 100) - feePerDate));
    lines.revenue.gameDay = Math.round(dates * f.fansPerDate * f.gameDaySpend * market);
    lines.costs.operations = Math.round(dates * dateCost(f, market));
    lines.costs.performanceBonuses = paid
      .filter((x) => x.teamId === teamId)
      .reduce((s, x) => s + x.amount, 0);
    emit('minor', [teamId], { kind: 'finance.settled', teamId, ...lines });
  }
}
