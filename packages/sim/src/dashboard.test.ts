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
  it('stops only on league-wide moments, your team, a long injury or an offer to you', () => {
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
          (e.kind === 'player.injured' && e.teamIds.includes(mine) && e.days >= 14) ||
          (e.kind === 'trade.offered' && e.teamIds.includes(mine)),
      );
      expect(reason || !!state.championTeamId).toBe(true);
      stops++;
    }
    expect(state.championTeamId).not.toBeNull();
  });
});

describe('streak and highlight news', () => {
  it('appears during a season, the same however you sim it', () => {
    const news = (chunk: number) => {
      const state = createLeague(54, ctx);
      const out: string[] = [];
      for (let d = 0; d < 200; d += chunk) {
        const res = handleCommand(state, { kind: 'sim.advance', days: chunk }, local, ctx);
        if (!res.ok) throw new Error(res.error.message);
        for (const e of res.events) {
          if (e.kind === 'news.posted')
            out.push(`${e.date.day} ${e.headline} ${JSON.stringify(e.params)}`);
        }
      }
      return out;
    };
    const whole = news(200);
    expect(whole).toEqual(news(10));
    for (const key of ['winStreak', 'losingStreak', 'hatTrick', 'shutout']) {
      expect(whole.some((l) => l.includes(`event.${key}`))).toBe(true);
    }
  });
});
