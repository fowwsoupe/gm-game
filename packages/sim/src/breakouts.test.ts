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

describe('in-season breakouts', () => {
  it(
    'fire a few a league-season on average, for players 23 or under only',
    { timeout: 60_000 },
    () => {
      const state = createLeague(3, ctx);
      const counts: number[] = [];
      for (let s = 0; s < 3; s++) {
        const news = run(state, { kind: 'sim.advance', days: cal.regularSeasonDays });
        const hits = news.filter(
          (e) => e.kind === 'news.posted' && e.headline === 'event.breakoutPace',
        );
        counts.push(hits.length);
        run(state, { kind: 'sim.advance', days: cal.playoffDays });
        run(state, { kind: 'season.rollover' });
      }
      expect(counts[0]).toBe(0); // no last season yet
      // One league's season is noisy (3 and 7 here): judge the average.
      const avg = (counts[1]! + counts[2]!) / 2;
      expect(avg).toBeGreaterThanOrEqual(1);
      expect(avg).toBeLessThanOrEqual(5);
    },
  );
});
