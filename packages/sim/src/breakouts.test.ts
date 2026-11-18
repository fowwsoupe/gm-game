import { describe, expect, it } from 'vitest';
import type { Actor, Command, LeagueEvent } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, type LeagueState } from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };
const cal = ctx.ruleset.season.calendar;

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

describe('breakouts', () => {
  it('young players who jump 7+ in a summer make news, about one a league-season', () => {
    const state = createLeague(3, ctx);
    const news: LeagueEvent[] = [];
    for (let s = 0; s < 3; s++) {
      run(state, { kind: 'sim.advance', days: cal.regularSeasonDays + cal.playoffDays });
      news.push(...run(state, { kind: 'season.rollover' }));
    }
    const breakouts = news.filter(
      (e) => e.kind === 'news.posted' && e.headline === 'event.breakout',
    );
    expect(breakouts.length).toBeGreaterThan(0);
    expect(breakouts.length).toBeLessThan(3 * 10);
    for (const e of breakouts) {
      if (e.kind !== 'news.posted') continue;
      expect(Number(e.params?.n)).toBeGreaterThanOrEqual(7);
    }
  });
});
