/**
 * Owner & finance engine.
 * Owns: each team's money and fans. Revenue and costs settle once a month (`finance.settled`),
 * with one more settlement for the playoffs; the reducer adds the difference to `state.cash` and
 * keeps the fans the event carries. Fan interest sets the crowd (with the arena's capacity, the
 * market and the ticket price) and prices the sponsorship and local media deals.
 * Later: budgets and projects (owner objectives live in `sim/owner`).
 */
import { NEW_FANS, type FinanceLines, type PlayerId, type TeamFans, type TeamId } from '@gm/shared';
import type { Emit, LeagueState } from '../core';
import { contractIn, type Ruleset } from '../cba';
import { capacityOf, marketOf, ticketPctOf } from '../people';
import type { SimContext } from '../context';

/** Days in a settlement month. */
export const MONTH_DAYS = 30;

// Fan behaviour: game feel, not league rules, and none of it is sourced (see the brief).
/** Share of interest above or below 50 that carries into next season. */
const FAN_CARRY = 0.7;
/** How far interest moves toward its target each month. */
const FAN_PULL = 0.3;
/** Target interest per point of points % away from .500 (a .600 team aims at 65). */
const FAN_WINNING = 150;
/** Target interest lost per percent of seats left empty. */
const FAN_EMPTY_SEATS = 0.5;
/** Interest gained for each playoff series played. */
const FAN_PLAYOFF_SERIES = 3;
/** Demand at interest 50, market 1 and the reference price, as a share of capacity. */
const DEMAND = 1.1;
/** How much a bigger market fills its building (demand x market^this). */
const DEMAND_MARKET = 0.2;
/** Demand x price^-this: an unsourced knob, not a realistic value. */
const ELASTICITY = 1.5;
/** Seasons between local media deals (sponsorship is renewed every summer). */
const MEDIA_TERM = 3;

/** A team's fans (an old save, or a new league: 50 across the board). */
export const fansOf = (state: LeagueState, teamId: TeamId): TeamFans =>
  state.fans[teamId] ?? NEW_FANS;

/** Average crowd a home date: demand from interest, market and price, up to the arena's capacity. */
export function crowd(capacity: number, interest: number, market: number, pct: number): number {
  const demand =
    DEMAND *
    (0.3 + (0.7 * interest) / 50) *
    market ** DEMAND_MARKET *
    (1 + pct / 100) ** -ELASTICITY;
  return Math.round(capacity * Math.min(1, demand));
}

const clampInterest = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;

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

/** Each team's points % in this season's regular-season games so far (.500 before any). */
function pointsPct(state: LeagueState, ctx: SimContext): Map<TeamId, number> {
  const { win, overtimeLoss } = ctx.ruleset.season.points;
  const tally = new Map<TeamId, { pts: number; gp: number }>();
  const add = (id: TeamId, pts: number) => {
    const t = tally.get(id) ?? { pts: 0, gp: 0 };
    tally.set(id, { pts: t.pts + pts, gp: t.gp + 1 });
  };
  for (const g of Object.values(state.results)) {
    if (g.playoffSeriesId) continue;
    const homeWon = g.homeScore > g.awayScore;
    add(g.homeTeamId, homeWon ? win : g.overtime ? overtimeLoss : 0);
    add(g.awayTeamId, homeWon ? (g.overtime ? overtimeLoss : 0) : win);
  }
  return new Map([...tally].map(([id, t]) => [id, t.pts / (win * t.gp)]));
}

/**
 * Settles the regular-season month that ends as `day` starts (see `settlesOn`). Day 0 opens the
 * season: interest carries over, sponsorship (and every third season local media) is priced at
 * it, and each contract's signing bonus is paid. Payroll, dead cap and the yearly lines are spread
 * over the regular season's days; gate and operations follow the home dates played. Then interest
 * moves toward what the team's results and empty seats say.
 * ponytail: payroll is read from today's rosters, so a player traded mid-month is paid by his new
 * team for the whole month; and the month's crowd uses the price on settlement day. Track days on
 * each roster and price if the money-flow chart needs it.
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
  const points = pointsPct(state, ctx);
  for (const [teamId, lines] of [...books].sort(([a], [b]) => a.localeCompare(b))) {
    const team = state.teams[teamId]!;
    const market = marketOf(team);
    const capacity = capacityOf(team, f.capacity);
    const pct = ticketPctOf(team, state.ticketPrices);
    const dates = homeDates.get(teamId) ?? 0;
    const fans = { ...fansOf(state, teamId) };
    if (day === 0) {
      fans.interest = clampInterest(50 + FAN_CARRY * (fans.interest - 50));
      fans.sponsorDeal = fans.interest;
      if (season % MEDIA_TERM === 0) fans.mediaDeal = fans.interest;
    }
    const seats = crowd(capacity, fans.interest, market, pct);
    const r = lines.revenue;
    r.gate = Math.round(dates * seats * f.ticketPrice * market * (1 + pct / 100));
    r.gameDay = Math.round(dates * seats * f.gameDaySpend * market);
    r.sponsorship = yearly(Math.round((f.sponsorship * market * fans.sponsorDeal) / 50));
    r.media = yearly(Math.round((f.localMedia * market * fans.mediaDeal) / 50));
    r.leagueShare = yearly(f.leagueShare);
    lines.costs.operations = yearly(f.operations.yearly) + Math.round(dateCost(f, market) * dates);
    if (dates > 0) {
      const target =
        50 +
        FAN_WINNING * ((points.get(teamId) ?? 0.5) - 0.5) -
        FAN_EMPTY_SEATS * 100 * (1 - seats / capacity);
      fans.interest = clampInterest(fans.interest + FAN_PULL * (target - fans.interest));
      fans.attendance = seats;
    }
    emit('minor', [teamId], {
      kind: 'finance.settled',
      teamId,
      homeDates: dates,
      fans,
      ...lines,
    });
  }
}

/**
 * Settles the playoffs once the champion is known: each home date sells out at the playoff
 * markup, less the players' share and the league's fee, plus game-day spend, the dates'
 * operations, and the performance bonuses just `paid`. Every series played lifts interest.
 */
export function settlePlayoffs(
  state: LeagueState,
  ctx: SimContext,
  emit: Emit,
  paid: readonly { playerId: PlayerId; teamId: TeamId; amount: number }[],
): void {
  const f = ctx.ruleset.finance;
  const { markupPct, playersPct, feePerDate } = f.playoffs;
  const series = Object.values(state.playoffSeries);
  for (const teamId of (Object.keys(state.teams) as TeamId[]).sort()) {
    const team = state.teams[teamId]!;
    const lines = empty();
    const dates = Object.values(state.results).filter(
      (g) => g.playoffSeriesId && g.homeTeamId === teamId,
    ).length;
    const market = marketOf(team);
    const seats = capacityOf(team, f.capacity);
    const price =
      f.ticketPrice *
      market *
      (1 + ticketPctOf(team, state.ticketPrices) / 100) *
      (1 + markupPct / 100);
    lines.revenue.playoffs = Math.round(
      dates * (seats * price * (1 - playersPct / 100) - feePerDate),
    );
    lines.revenue.gameDay = Math.round(dates * seats * f.gameDaySpend * market);
    lines.costs.operations = Math.round(dates * dateCost(f, market));
    lines.costs.performanceBonuses = paid
      .filter((x) => x.teamId === teamId)
      .reduce((s, x) => s + x.amount, 0);
    const played = series.filter((s) => s.higherTeamId === teamId || s.lowerTeamId === teamId);
    const fans = { ...fansOf(state, teamId) };
    fans.interest = clampInterest(fans.interest + FAN_PLAYOFF_SERIES * played.length);
    emit('minor', [teamId], {
      kind: 'finance.settled',
      teamId,
      homeDates: dates,
      fans,
      ...lines,
    });
  }
}
