import { describe, expect, it } from 'vitest';
import type { Team, TeamId } from '@gm/shared';
import { defaultContext, Rng } from './index';
import { makeSchedule } from './league';

const ctx = defaultContext();
const { gamesPerTeam } = ctx.ruleset.season;
const days = ctx.ruleset.season.calendar.regularSeasonDays;
const league = () => ctx.sport.generateLeague(new Rng(7).fork('league'), ctx.ruleset).teams;

/** Per team: games, home games, back-to-backs, games vs each opponent. */
function summarize(teams: Team[], seed: number) {
  const games = makeSchedule(2027, teams, gamesPerTeam, days, new Rng(seed));
  const by = new Map(
    teams.map((t) => [
      t.id,
      { n: 0, home: 0, days: [] as number[], vs: new Map<TeamId, number>() },
    ]),
  );
  for (const g of games) {
    for (const [me, other] of [
      [g.homeTeamId, g.awayTeamId],
      [g.awayTeamId, g.homeTeamId],
    ] as const) {
      const s = by.get(me)!;
      s.n++;
      s.days.push(g.date.day);
      s.vs.set(other, (s.vs.get(other) ?? 0) + 1);
    }
    by.get(g.homeTeamId)!.home++;
  }
  return { games, by };
}

describe('schedule', () => {
  it.each([1, 2, 3, 4, 5])(
    'seed %i: exact games, one a day, balanced home/away, few back-to-backs',
    (seed) => {
      const teams = league();
      const { games, by } = summarize(teams, seed);
      expect(games.every((g) => g.date.day >= 0 && g.date.day < days)).toBe(true);
      for (const s of by.values()) {
        expect(s.n).toBe(gamesPerTeam);
        expect(new Set(s.days).size).toBe(s.days.length);
        expect(Math.abs(s.home - gamesPerTeam / 2)).toBeLessThanOrEqual(2);
        const b2b = s.days.sort((a, b) => a - b).filter((d, i, a) => a[i - 1] === d - 1).length;
        expect(b2b).toBeLessThanOrEqual(32);
      }
    },
  );

  it('plays division rivals more than conference rivals, and those more than the rest', () => {
    const teams = league();
    const { by } = summarize(teams, 1);
    const me = teams[0]!;
    const avg = (pick: (t: Team) => boolean) => {
      const others = teams.filter((t) => t.id !== me.id && pick(t));
      return others.reduce((s, t) => s + (by.get(me.id)!.vs.get(t.id) ?? 0), 0) / others.length;
    };
    const div = avg((t) => t.division === me.division);
    const conf = avg((t) => t.conference === me.conference && t.division !== me.division);
    const rest = avg((t) => t.conference !== me.conference);
    expect(div).toBeGreaterThan(conf);
    expect(conf).toBeGreaterThan(rest);
  });

  it('without structure it still plays a full flat schedule', () => {
    const flat = league().map((t) => ({ id: t.id }) as Team);
    const { by } = summarize(flat, 1);
    for (const s of by.values()) expect(s.n).toBe(gamesPerTeam);
  });

  it('is the same for the same seed', () => {
    const a = makeSchedule(2027, league(), gamesPerTeam, days, new Rng(9));
    const b = makeSchedule(2027, league(), gamesPerTeam, days, new Rng(9));
    expect(a).toEqual(b);
  });
});
