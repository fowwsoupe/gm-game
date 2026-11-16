import { describe, expect, it } from 'vitest';
import type { Actor } from '@gm/shared';
import { createLeague, dashboard, defaultContext, handleCommand } from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

describe('home dashboard', () => {
  it('lists what needs a decision and the next game', () => {
    const state = createLeague(51, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const start = dashboard(state, ctx, mine);
    expect(start.todo).toEqual([]);
    expect(start.nextGame).not.toBeNull();

    const roster = Object.values(state.players).filter((p) => p.teamId === mine);
    roster[0]!.injuredUntil = ctx.ruleset.season.calendar.tradeDeadlineDay + 10;
    roster.find((p) => p.position === 'G')!.teamId = null;
    state.date = { ...state.date, day: ctx.ruleset.season.calendar.tradeDeadlineDay - 3 };
    const codes = dashboard(state, ctx, mine).todo.map((i) => i.code);
    expect(codes).toEqual(['injured', 'rosterShort', 'deadline']);
  });

  it('asks for re-signings and a draft list once the season is over', () => {
    const state = createLeague(52, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    handleCommand(state, { kind: 'sim.advance', days: 300 }, local, ctx);
    const codes = dashboard(state, ctx, mine).todo.map((i) => i.code);
    expect(codes).toContain('draftList');
    expect(dashboard(state, ctx, mine).nextGame).toBeNull();
    handleCommand(state, { kind: 'offseason.openFreeAgency' }, local, ctx);
    const after = dashboard(state, ctx, mine).todo.map((i) => i.code);
    expect(after).toContain('freeAgency');
    expect(after).not.toContain('resign');
  });
});
