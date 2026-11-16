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

describe('sim until it matters', () => {
  it('stops only on league-wide moments, your team, or a long injury to your player', () => {
    const state = createLeague(53, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    let stops = 0;
    while (!state.championTeamId && stops < 40) {
      const res = handleCommand(
        state,
        { kind: 'sim.advance', days: 400, stopOn: 'major' },
        local,
        ctx,
      );
      if (!res.ok) throw new Error(res.error.message);
      const lastDay = res.events.filter((e) => e.date.day === res.events.at(-1)!.date.day);
      const reason = lastDay.some(
        (e) =>
          (e.importance === 'major' && (e.teamIds.length === 0 || e.teamIds.includes(mine))) ||
          (e.kind === 'player.injured' && e.teamIds.includes(mine) && e.days >= 14),
      );
      expect(reason || !!state.championTeamId).toBe(true);
      stops++;
    }
    expect(state.championTeamId).not.toBeNull();
  });
});
