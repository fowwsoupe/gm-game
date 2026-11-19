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

describe('AI owners in the feed', () => {
  it("an AI owner losing faith in his GM makes the league's news", () => {
    const state = createLeague(5, ctx);
    const events: LeagueEvent[] = [];
    for (let s = 0; s < 3; s++) {
      events.push(
        ...run(state, { kind: 'sim.advance', days: cal.regularSeasonDays + cal.playoffDays }),
      );
      events.push(...run(state, { kind: 'season.rollover' }));
    }
    const news = events.filter(
      (e) => e.kind === 'news.posted' && e.headline === 'event.ownerFrustrated',
    );
    expect(news.length).toBeGreaterThan(0);
    for (const e of news) expect(state.teams[e.teamIds[0]!]!.userControlled).toBe(false);
    // At most one headline per team a season, however often confidence crosses the line.
    const keys = news.map((e) => `${e.teamIds[0]}:${e.date.season}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
