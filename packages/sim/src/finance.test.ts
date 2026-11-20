import { describe, expect, it } from 'vitest';
import type { Actor, Command, LeagueEvent, TeamId } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  handleCommand,
  leagueStandings,
  net,
  type LeagueState,
} from './index';
import { summerLeague } from './testLeagues';

const ctx = defaultContext();
const days = ctx.ruleset.season.calendar.regularSeasonDays;

function run(state: LeagueState, command: Command, actor: Actor = { id: 'local', controls: [] }) {
  const res = handleCommand(state, command, actor, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

const settled = (events: readonly LeagueEvent[], teamId: TeamId) =>
  events.flatMap((e) => (e.kind === 'finance.settled' && e.teamId === teamId ? [e] : []));

describe('the ledger', () => {
  it('pays signing bonuses on day one, and cash is what the months net', () => {
    const state = createLeague(1, ctx);
    const p = Object.values(state.players).find((x) => x.teamId && x.contract)!;
    p.contract = { ...p.contract!, bonus: 2_000_000 };
    const teamId = p.teamId!;
    const bonuses = Object.values(state.players)
      .filter((x) => x.teamId === teamId)
      .reduce((s, x) => s + (x.contract?.bonus ?? 0), 0);

    // Through camp (no settlements) and opening night.
    const [day1] = settled(run(state, { kind: 'sim.advance', days: 1 - state.date.day }), teamId);
    expect(day1!.date.day).toBe(0);
    expect(day1!.costs.signingBonuses).toBe(bonuses);
    expect(day1!.costs.salaries).toBe(0);
    expect(state.cash[teamId]).toBe(-bonuses);

    const months = settled(run(state, { kind: 'sim.advance', days }), teamId);
    expect(months.every((m) => m.costs.signingBonuses === 0)).toBe(true);
    expect(state.cash[teamId]).toBe([day1!, ...months].reduce((s, m) => s + net(m), 0));
  });

  it('pays a buyout over the season it is charged to', () => {
    const state = summerLeague(1);
    const season = state.date.season + 1;
    const p = Object.values(state.players).find(
      (x) => x.teamId && x.contract && x.contract.expiresAfterSeason > season,
    )!;
    const teamId = p.teamId!;
    run(state, { kind: 'team.setUserControlled', teamId, userControlled: true });
    run(state, { kind: 'contract.buyout', playerId: p.id });
    const owed = state.capCharges
      .filter((c) => c.teamId === teamId && c.season === season && c.kind !== 'bonusOverage')
      .reduce((s, c) => s + c.amount, 0);
    expect(owed).toBeGreaterThan(0);

    run(state, { kind: 'season.rollover' });
    const months = settled(
      run(state, { kind: 'sim.advance', days: days + 1 - state.date.day }),
      teamId,
    );
    expect(months.reduce((s, m) => s + m.costs.deadCap, 0)).toBe(owed);
  });
});

describe('fans and ticket prices', () => {
  const month = (events: readonly LeagueEvent[], teamId: TeamId) =>
    settled(events, teamId).find((e) => e.date.day === 30)!;

  it('+20% on a losing team sells fewer seats and earns less at the gate', () => {
    const base = createLeague(2, ctx);
    const teamId = Object.keys(base.teams)[0] as TeamId;
    run(base, { kind: 'team.setUserControlled', teamId, userControlled: true });
    base.fans[teamId] = { interest: 30, sponsorDeal: 30, mediaDeal: 30, attendance: 0 };
    const [cheap, dear] = [0, 20].map((pct) => {
      const state = structuredClone(base);
      run(state, { kind: 'finance.setTicketPrice', teamId, pct });
      return month(run(state, { kind: 'sim.advance', days: 31 - state.date.day }), teamId);
    });
    expect(dear!.fans.attendance).toBeLessThan(cheap!.fans.attendance);
    expect(dear!.revenue.gate).toBeLessThan(cheap!.revenue.gate);
  });

  it('refuses a price that is not a step, or another team', () => {
    const state = createLeague(2, ctx);
    const teamId = Object.keys(state.teams)[0] as TeamId;
    const set = (pct: number) =>
      handleCommand(
        state,
        { kind: 'finance.setTicketPrice', teamId, pct },
        { id: 'x', controls: [teamId] },
        ctx,
      );
    expect(set(15).ok).toBe(false);
    expect(set(10).ok).toBe(true);
    expect(
      handleCommand(
        state,
        { kind: 'finance.setTicketPrice', teamId, pct: 10 },
        { id: 'x', controls: [] },
        ctx,
      ).ok,
    ).toBe(false);
  });

  it("a winning season raises next season's attendance, a losing one lowers it", () => {
    // Seed 4: on seed 3 the last-place team's fans sit below their target and still warm up.
    const state = createLeague(4, ctx);
    // Dear tickets everywhere, so no building sells out and every change in demand shows.
    for (const id of Object.keys(state.teams)) state.ticketPrices[id as TeamId] = 20;
    const first = run(state, { kind: 'sim.advance', days: 220 - state.date.day });
    const rows = leagueStandings(state, ctx.ruleset);
    const [best, worst] = [rows[0]!.teamId, rows[rows.length - 1]!.teamId];
    run(state, { kind: 'season.rollover' });
    const second = run(state, { kind: 'sim.advance', days: 31 - state.date.day });
    expect(month(second, best).fans.attendance).toBeGreaterThan(month(first, best).fans.attendance);
    expect(month(second, worst).fans.attendance).toBeLessThan(month(first, worst).fans.attendance);
  });
});
