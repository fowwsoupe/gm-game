import { describe, expect, it } from 'vitest';
import type { Actor, Command, LeagueEvent, TeamId } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, net, type LeagueState } from './index';
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

    const [day1] = settled(run(state, { kind: 'sim.advance', days: 1 }), teamId);
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
    const months = settled(run(state, { kind: 'sim.advance', days: days + 1 }), teamId);
    expect(months.reduce((s, m) => s + m.costs.deadCap, 0)).toBe(owed);
  });
});
