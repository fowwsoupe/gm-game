import { describe, expect, it } from 'vitest';
import type { Actor, Command, StandingsRow, TeamId } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, type LeagueState } from './index';
import { classifyTeams, worstFirst, type PulseInput } from './league';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

describe('teams in crisis', () => {
  it('a losing team whose owner has lost faith is in crisis; a winning one never', () => {
    const state = createLeague(5, ctx);
    run(state, { kind: 'sim.advance', days: 1 }); // the preseason meeting
    for (const o of Object.values(state.owners)) o.confidence = 10;
    run(state, { kind: 'sim.advance', days: 60 });
    const statuses = Object.values(state.teamStatus);
    expect(statuses).toContain('crisis');
    expect(statuses).not.toContain('seller');
    expect(statuses).not.toContain('rebuilder');
    expect(statuses).toContain('contender');
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    expect(state.teamStatus[mine]).not.toBe('crisis');
  });
});

describe('the league pulse', () => {
  it('reads playoff odds, then roster age and cap space', () => {
    const rows: StandingsRow[] = Array.from({ length: 10 }, (_, i) => ({
      teamId: `t${i}` as TeamId,
      gp: 20,
      w: 10,
      l: 10,
      otl: 0,
      pts: 20,
      gf: 50,
      ga: 50,
    }));
    const base = (i: number): PulseInput => ({ odds: 0.9 - i * 0.05, age: 27, capRoom: 0 });
    const inputs = new Map(rows.map((r, i) => [r.teamId, base(i)]));
    const before: Record<string, string> = classifyTeams(rows, inputs);
    expect(before.t3).toBe('buyer');
    expect(before.t5).toBe('bubble');
    expect(before.t7).toBe('seller');
    expect(before.t9).toBe('rebuilder');

    // Last in the table with the best odds: first, and everyone else one place down.
    inputs.set('t9' as TeamId, { ...base(9), odds: 0.99 });
    inputs.set('t3' as TeamId, { ...base(3), age: 29, capRoom: 0.1 }); // old, room to spend
    inputs.set('t4' as TeamId, { ...base(4), age: 29 }); // old, no room
    inputs.set('t7' as TeamId, { ...base(7), age: 25 }); // young and out of it
    const after: Record<string, string> = classifyTeams(rows, inputs);
    expect(after.t9).toBe('contender');
    expect(after.t3).toBe('buyer');
    expect(after.t4).toBe('bubble');
    expect(after.t6).toBe('seller');
    expect(after.t7).toBe('rebuilder');
  });

  it('shows every status at the trade deadline', () => {
    const state = createLeague(4, ctx);
    const deadline = ctx.ruleset.season.calendar.tradeDeadlineDay;
    run(state, { kind: 'sim.advance', days: deadline - 7 });
    // The last-place team's owner loses faith: it goes into crisis at the deadline's pulse.
    state.owners[worstFirst(state, ctx.ruleset)[0]!]!.confidence = 10;
    run(state, { kind: 'sim.advance', days: deadline - state.date.day });
    expect(new Set(Object.values(state.teamStatus))).toEqual(
      new Set(['contender', 'buyer', 'bubble', 'seller', 'rebuilder', 'crisis']),
    );
  });
});
