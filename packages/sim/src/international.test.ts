import { describe, expect, it } from 'vitest';
import type { LeagueEvent } from '@gm/shared';
import { createLeague, defaultContext, emitter, nationOf, Rng } from './index';
import { playInternational } from './offseason';

const ctx = defaultContext();
const base = createLeague(1, ctx);

/** The tournament step on a copy of the league for `season`: the copy and its events. */
function summer(season: number, human = false) {
  const state = structuredClone(base);
  for (const t of Object.values(state.teams)) t.userControlled = human;
  const events: LeagueEvent[] = [];
  playInternational(state, ctx, new Rng(9), emitter(state, events), season);
  return { state, events };
}

describe('international tournament', () => {
  it('six nations, six group games, two semi-finals, a final and one champion', () => {
    const { state, events } = summer(2028);
    const played = events.filter((e) => e.kind === 'international.played');
    expect(played).toHaveLength(1);
    const t = state.international[0]!;
    expect(t.season).toBe(2028);
    expect(t.groups.map((g) => g.length)).toEqual([3, 3]);
    expect(
      t.groups
        .flat()
        .map((r) => r.nation)
        .sort(),
    ).toEqual(Object.keys(ctx.sport.nations).sort());
    expect(t.games).toHaveLength(9);
    expect(t.groups.flat().reduce((a, r) => a + r.wins, 0)).toBe(6);
    const final = t.games[8]!;
    const finalists = [final.home, final.away];
    expect(finalists).toContain(t.champion);
    // The finalists won their semi-finals.
    for (const semi of t.games.slice(6, 8)) {
      expect(finalists).toContain(semi.homeScore > semi.awayScore ? semi.home : semi.away);
    }
    expect(t.best?.value).toBeGreaterThan(0);
    // Not league games, and the league's random stream is untouched.
    expect(state.results).toEqual(base.results);
    expect(state.rngState).toBe(base.rngState);
  });

  it('the same on a replay, and none in the seasons between', () => {
    expect(summer(2028).state.international).toEqual(summer(2028).state.international);
    for (const season of [2027, 2029, 2030, 2031]) expect(summer(season).events).toEqual([]);
    expect(summer(2032).state.international).toHaveLength(1);
  });

  it("your players' medals make your news", () => {
    const { state, events } = summer(2028, true);
    const medals = events.filter((e) => e.kind === 'news.posted');
    expect(medals.length).toBeGreaterThan(10);
    expect(
      medals.some((e) => e.kind === 'news.posted' && e.headline === 'event.internationalGold'),
    ).toBe(true);
    expect(summer(2028).events.filter((e) => e.kind === 'news.posted')).toEqual([]);
    expect(state.international).toHaveLength(1);
  });

  it('nations follow the sport’s shares', () => {
    const ids = Object.keys(base.players);
    const canada = ids.filter((id) => nationOf(id, ctx.sport.nations) === 'canada').length;
    expect(canada / ids.length).toBeGreaterThan(0.3);
    expect(canada / ids.length).toBeLessThan(0.4);
    expect(nationOf(ids[0]!, ctx.sport.nations)).toBe(nationOf(ids[0]!, ctx.sport.nations));
  });
});
