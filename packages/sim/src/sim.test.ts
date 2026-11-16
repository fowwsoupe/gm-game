import { describe, expect, it } from 'vitest';
import type { Actor, LeagueEvent, TeamId } from '@gm/shared';
import {
  applyEvent,
  bracketSeeds,
  computeStandings,
  createLeague,
  defaultContext,
  elcYears,
  handleCommand,
  NHL_2026,
  percentileRank,
  playerProfiles,
  Rng,
  seedPlayoffs,
  validateContract,
  dollars,
  type LeagueState,
} from './index';

const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();

function simSeason(seed: number) {
  const state = createLeague(seed, ctx);
  const res = handleCommand(state, { kind: 'sim.advance', days: 220 }, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return { state, events: res.events };
}

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
  });

  it('forks into independent streams', () => {
    const r = new Rng(1);
    expect(r.fork('a').next()).not.toEqual(r.fork('b').next());
  });
});

describe('season sim', () => {
  it('is fully deterministic for the same seed', () => {
    expect(simSeason(7).events).toEqual(simSeason(7).events);
  });

  it('plays every scheduled game, with a winner each time', () => {
    const { state } = simSeason(3);
    const results = Object.values(state.results).filter((g) => !g.playoffSeriesId);
    expect(results.length).toBe(state.schedule.length);
    for (const g of results) expect(g.homeScore).not.toEqual(g.awayScore);
  });

  it('gives each team the ruleset number of games', () => {
    const { state } = simSeason(5);
    const rows = computeStandings(
      Object.keys(state.teams) as TeamId[],
      Object.values(state.results),
    );
    for (const r of rows) expect(r.gp).toBe(NHL_2026.season.gamesPerTeam);
  });

  it('scoring lands in a realistic NHL range', () => {
    const results = Object.values(simSeason(11).state.results).filter((g) => !g.playoffSeriesId);
    const perTeam =
      results.reduce((s, g) => s + g.homeScore + g.awayScore, 0) / (results.length * 2);
    expect(perTeam).toBeGreaterThan(2.5);
    expect(perTeam).toBeLessThan(3.8);
  });
});

describe('events and reducer', () => {
  it('a second copy that replays the events ends up identical', () => {
    const live = createLeague(9, ctx);
    const replica: LeagueState = structuredClone(live);
    const res = handleCommand(live, { kind: 'sim.advance', days: 30 }, local, ctx);
    if (!res.ok) throw new Error();
    res.events.forEach((e: LeagueEvent) => applyEvent(replica, e));
    expect(replica).toEqual(live);
  });

  it('event ids are unique', () => {
    const ids = simSeason(2).events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects commands for teams a remote player does not control', () => {
    const state = createLeague(1, ctx);
    const team = Object.keys(state.teams)[0] as TeamId;
    const res = handleCommand(
      state,
      { kind: 'team.setUserControlled', teamId: team, userControlled: true },
      { id: 'remote-1', controls: [] },
      ctx,
    );
    expect(res.ok).toBe(false);
  });
});

describe('playoffs', () => {
  it('seeds a fixed bracket from regular-season points', () => {
    const { state } = simSeason(12);
    const rows = computeStandings(
      Object.keys(state.teams) as TeamId[],
      Object.values(state.results),
    );
    expect(bracketSeeds(ctx.ruleset.playoffs.teamsQualifying)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const firstRound = Object.values(state.playoffSeries).filter((s) => s.round === 1);
    for (const series of firstRound) {
      expect(series.higherTeamId).toBe(rows[series.higherSeed - 1]!.teamId);
      expect(series.lowerTeamId).toBe(rows[series.lowerSeed - 1]!.teamId);
    }
  });

  it('plays one bracket per conference, then a cross-conference final', () => {
    const { state } = simSeason(12);
    const conf = (id: TeamId) => state.teams[id]!.conference;
    const all = Object.values(state.playoffSeries);
    for (const s of all.filter((x) => x.round < 3)) {
      expect(conf(s.higherTeamId)).toBe(conf(s.lowerTeamId));
    }
    const final = all.find((x) => x.round === 3)!;
    expect(conf(final.higherTeamId)).not.toBe(conf(final.lowerTeamId));
    // Home ice in the final goes to the better regular season.
    expect(final.higherSeed).toBeLessThan(final.lowerSeed);
  });

  it('seeds NHL-style wild cards: top three per division plus two per conference', () => {
    // 32 teams t00..t31: conference by half, division by quarter; t00 is the best record.
    const teams = Array.from({ length: 32 }, (_, i) => ({
      id: `t${String(i).padStart(2, '0')}` as TeamId,
      conference: i % 2 === 0 ? 'East' : 'West',
      division: `${i % 2 === 0 ? 'E' : 'W'}${Math.floor(i / 16)}`,
    }));
    const rows = teams.map((t, i) => ({
      teamId: t.id,
      gp: 84,
      w: 60 - i,
      l: i,
      otl: 0,
      pts: 120 - i,
      gf: 250,
      ga: 250,
    }));
    const series = seedPlayoffs(rows, NHL_2026, 1, teams);
    expect(series).toHaveLength(8);
    const east = series.filter((s) => s.id.endsWith('_0') || Number(s.id.split('_')[2]) < 4);
    // Division winner (t00) meets the lower wild card; wild cards are the best non-top-three teams.
    const first = east.find((s) => s.higherTeamId === 't00')!;
    expect(first.lowerTeamId).toBe('t08');
    const eastTeams = new Set<string>(east.flatMap((s) => [s.higherTeamId, s.lowerTeamId]));
    expect(eastTeams.size).toBe(8);
    expect(eastTeams.has('t06')).toBe(true);
    expect(eastTeams.has('t08')).toBe(true);
    for (const s of series) {
      expect(teams.find((t) => t.id === s.higherTeamId)!.conference).toBe(
        teams.find((t) => t.id === s.lowerTeamId)!.conference,
      );
    }
  });

  it('keeps the NHL ruleset at sixteen qualifiers', () => {
    expect(NHL_2026.playoffs.teamsQualifying).toBe(16);
    expect(bracketSeeds(NHL_2026.playoffs.teamsQualifying)).toHaveLength(16);
  });

  it('ends each best-of-seven at four wins with the correct home pattern and no shootouts', () => {
    const { state } = simSeason(13);
    const pattern = ctx.ruleset.playoffs.homeIcePattern;
    for (const series of Object.values(state.playoffSeries)) {
      const games = Object.values(state.results).filter((g) => g.playoffSeriesId === series.id);
      expect(Math.max(series.higherWins, series.lowerWins)).toBe(4);
      expect(games).toHaveLength(series.higherWins + series.lowerWins);
      games.forEach((game, i) => {
        expect(game.homeTeamId).toBe(pattern[i] === 1 ? series.lowerTeamId : series.higherTeamId);
        expect(game.homeScore).not.toBe(game.awayScore);
        expect(game.stats.shootout).toBe(0);
      });
    }
    expect(state.championTeamId).not.toBeNull();
  });

  it('crowns the same champion for the same seed and replays every event', () => {
    const live = createLeague(14, ctx);
    const replica: LeagueState = structuredClone(live);
    const res = handleCommand(live, { kind: 'sim.advance', days: 220 }, local, ctx);
    if (!res.ok) throw new Error();
    res.events.forEach((e) => applyEvent(replica, e));
    expect(replica).toEqual(live);
    expect(live.championTeamId).toBe(simSeason(14).state.championTeamId);
    expect(res.events.filter((e) => e.kind === 'champion.crowned')).toHaveLength(1);
  });

  it('stops at a series win and later at the championship', () => {
    const state = createLeague(15, ctx);
    let sawSeries = false;
    let sawChampion = false;
    for (let i = 0; i < 20 && !sawChampion; i++) {
      const res = handleCommand(
        state,
        { kind: 'sim.advance', days: 400, stopOn: 'major' },
        local,
        ctx,
      );
      if (!res.ok) throw new Error();
      const series = res.events.some((e) => e.kind === 'series.won');
      const champion = res.events.some((e) => e.kind === 'champion.crowned');
      if (series) sawSeries = true;
      if (champion) sawChampion = true;
      if (series || champion) expect(res.events.at(-1)?.kind).toBe('clock.advanced');
    }
    expect(sawSeries).toBe(true);
    expect(sawChampion).toBe(true);
  });
});

describe('CBA rules', () => {
  it('validates contract length, minimum and maximum from the ruleset', () => {
    expect(
      validateContract(NHL_2026, {
        salaries: Array(7).fill(dollars(5)),
        signingAge: 27,
        isResign: true,
      }),
    ).toEqual([]);
    const tooLong = validateContract(NHL_2026, {
      salaries: Array(7).fill(dollars(5)),
      signingAge: 27,
      isResign: false,
    });
    expect(tooLong.map((i) => i.code)).toContain('too_long');
    const tooRich = validateContract(NHL_2026, {
      salaries: [dollars(25)],
      signingAge: 27,
      isResign: true,
    });
    expect(tooRich.map((i) => i.code)).toContain('above_maximum');
  });

  it('enforces salary variance (20% step, 71% floor)', () => {
    const ok = validateContract(NHL_2026, {
      salaries: [dollars(10), dollars(9), dollars(8)],
      signingAge: 28,
      isResign: true,
    });
    expect(ok).toEqual([]);
    const frontLoaded = validateContract(NHL_2026, {
      salaries: [dollars(12), dollars(6), dollars(6)],
      signingAge: 28,
      isResign: true,
    });
    expect(frontLoaded.map((i) => i.code)).toEqual(
      expect.arrayContaining(['variance', 'year_too_low']),
    );
  });

  it('gives entry-level length by age', () => {
    expect(elcYears(NHL_2026, 18)).toBe(3);
    expect(elcYears(NHL_2026, 23)).toBe(2);
    expect(elcYears(NHL_2026, 30)).toBeNull();
  });
});

describe('players', () => {
  it('percentile ranks', () => {
    expect(percentileRank(90, [10, 20, 30, 90])).toBe(88);
    expect(percentileRank(5, [10, 20])).toBe(0);
  });
});

describe('player profiles', () => {
  it('ranks every rating within its group and carries the season line', () => {
    const { state } = simSeason(11);
    const teamId = Object.keys(state.teams)[0] as TeamId;
    const cards = playerProfiles(state, ctx, teamId);
    expect(cards.length).toBeGreaterThan(15);
    for (const c of cards) {
      expect(c.teamId).toBe(teamId);
      expect(c.percentiles.length).toBe(c.position === 'G' ? 4 : 8);
      for (const p of c.percentiles) expect(p.value).toBeGreaterThanOrEqual(0);
      for (const p of c.percentiles) expect(p.value).toBeLessThanOrEqual(100);
    }
    // Position order: centres first, goalies last.
    expect(cards[0]!.position).toBe('C');
    expect(cards.at(-1)!.position).toBe('G');
    expect(cards.some((c) => (c.stats.gp ?? 0) > 50)).toBe(true);
    expect(cards.find((c) => c.position === 'G' && c.stats.gp)?.stats.savePct).toBeGreaterThan(0.8);
  });
});

describe('builds and role tags', () => {
  it('spread across the league, with tags only for standout skills', () => {
    const state = createLeague(91, ctx);
    const cards = Object.keys(state.teams).flatMap((id) =>
      playerProfiles(state, ctx, id as TeamId),
    );
    const builds = new Map<string, number>();
    for (const c of cards) builds.set(c.build, (builds.get(c.build) ?? 0) + 1);
    // Every build is used, and none takes over a group.
    expect(builds.size).toBe(10);
    const forwards = cards.filter((c) => ['C', 'LW', 'RW'].includes(c.position)).length;
    for (const b of ['sniper', 'playmaker', 'powerForward', 'twoWay', 'grinder']) {
      expect(builds.get(b)! / forwards).toBeLessThan(0.5);
    }
    for (const c of cards) {
      expect(c.tags.length).toBeLessThanOrEqual(2);
      if (c.tags.length)
        expect(Math.max(...c.percentiles.map((x) => x.value))).toBeGreaterThanOrEqual(90);
    }
  });
});

describe('hall of fame rule', () => {
  const hof = ctx.sport.hallOfFame;
  it('inducts long, productive careers and repeat MVPs, and sums the totals', () => {
    const season = { gp: 80, goals: 30, assists: 40, points: 70 };
    expect(hof({ position: 'C', seasons: Array(15).fill(season), awards: [] })).toMatchObject({
      inducted: true,
      totals: { gp: 1200, points: 1050 },
    });
    expect(hof({ position: 'C', seasons: Array(5).fill(season), awards: ['mvp'] }).inducted).toBe(
      false,
    );
    expect(
      hof({ position: 'C', seasons: Array(5).fill(season), awards: ['mvp', 'mvp'] }).inducted,
    ).toBe(true);
    const goalie = { gp: 60, shotsAgainst: 1800, saves: 1640, savePct: 0.911 };
    const g = hof({ position: 'G', seasons: Array(14).fill(goalie), awards: [] });
    expect(g.inducted).toBe(true);
    expect(g.totals.savePct).toBeCloseTo(1640 / 1800, 5);
  });
});
