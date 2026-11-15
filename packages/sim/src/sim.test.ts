import { describe, expect, it } from 'vitest';
import type { Actor, GameId, HockeyBoxScore, LeagueEvent, TeamId } from '@gm/shared';
import {
  applyEvent,
  autoLineup,
  bracketSeeds,
  computeStandings,
  createLeague,
  defaultContext,
  elcYears,
  handleCommand,
  ICE_TIME,
  NHL_2026,
  overall,
  percentileRank,
  Rng,
  seedPlayoffs,
  simGame,
  teamStrength,
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

describe('lines and goalies', () => {
  const roster = () => {
    const state = createLeague(4, ctx);
    return Object.values(state.players).filter((p) => p.teamId === 't1');
  };

  it('puts the best players of each position together on the top line', () => {
    const lineup = autoLineup(roster());
    const [first, second] = lineup.forwards;
    expect(first!.map((p) => p.position)).toEqual(['C', 'LW', 'RW']);
    expect(overall(first![0]!)).toBeGreaterThanOrEqual(overall(second![0]!));
    expect(lineup.defense).toHaveLength(3);
    expect(lineup.goalies.length).toBeGreaterThanOrEqual(2);
  });

  it('a small boost counts in proportion to the ice time of the line it is on', () => {
    const players = roster();
    const lineup = autoLineup(players);
    const base = teamStrength(players).offense;
    const gain = (line: (typeof players)[number][]) => {
      const ids = new Set(line.map((p) => p.id));
      const boosted = players.map((p) =>
        ids.has(p.id)
          ? {
              ...p,
              ratings: Object.fromEntries(Object.entries(p.ratings).map(([k, v]) => [k, v + 0.01])),
            }
          : p,
      );
      return teamStrength(boosted).offense - base;
    };
    const [top, second, , fourth] = ICE_TIME.forwardLines;
    expect(gain(lineup.forwards[0]!) / gain(lineup.forwards[1]!)).toBeCloseTo(top / second, 3);
    expect(gain(lineup.forwards[0]!) / gain(lineup.forwards[3]!)).toBeCloseTo(top / fourth, 3);
    for (const weights of [ICE_TIME.forwardLines, ICE_TIME.defensePairs]) {
      expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    }
  });

  it('the backup goalie starts the second night of a back-to-back, but never in the playoffs', () => {
    const strength = teamStrength(roster());
    expect(strength.goaltending).not.toBe(strength.backupGoaltending);
    const goalieUsed = (input: { homeBackToBack?: boolean; playoff?: boolean }) => {
      let used = 0;
      const model = {
        expectedGoals: (home: typeof strength) => ((used = home.goaltending), { home: 1, away: 1 }),
      };
      simGame(
        {
          id: 'g' as GameId,
          homeTeamId: 't1' as TeamId,
          awayTeamId: 't2' as TeamId,
          home: strength,
          away: strength,
          ...input,
        },
        new Rng(1),
        model,
      );
      return used;
    };
    expect(goalieUsed({})).toBe(strength.goaltending);
    expect(goalieUsed({ homeBackToBack: true })).toBe(strength.backupGoaltending);
    expect(goalieUsed({ homeBackToBack: true, playoff: true })).toBe(strength.goaltending);
  });
});

describe('box scores', () => {
  const { state } = simSeason(21);
  const games = Object.values(state.results).filter((g) => g.box);

  it('every game has one, and it adds up to the score', () => {
    expect(games.length).toBe(Object.keys(state.results).length);
    for (const g of games) {
      const box = g.box as HockeyBoxScore;
      const shootout = g.stats.shootout === 1;
      for (const [key, goals, against] of [
        ['home', g.homeScore, g.awayScore],
        ['away', g.awayScore, g.homeScore],
      ] as const) {
        const side = box[key];
        const credited = goals - (shootout && goals > against ? 1 : 0);
        if (side.skaters.length === 0) continue;
        expect(side.skaters.reduce((n, s) => n + s.goals, 0)).toBe(credited);
        // Five skaters for 60 minutes, minus the minutes a man down on a penalty.
        const shorthanded =
          box.penalties.filter((p) => p[1] === (key === 'home' ? 0 : 1)).length * 2;
        const toi = side.skaters.reduce((n, s) => n + s.toi, 0);
        expect(Math.abs(toi - (300 - shorthanded))).toBeLessThan(1.5);
        const goalie = box[key === 'home' ? 'away' : 'home'].goalie;
        expect(goalie.shotsAgainst - goalie.saves).toBe(credited);
      }
      expect(box.shots.length).toBe((g.stats.homeShots ?? 0) + (g.stats.awayShots ?? 0));
      expect(box.shots.filter((s) => s[5] === 1).length).toBe(
        g.homeScore + g.awayScore - (shootout ? 1 : 0),
      );
      for (const side of [box.home, box.away]) {
        for (const p of side.skaters) expect(p.assists).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('penalties and the power play line up', () => {
    let ppGoals = 0;
    let goals = 0;
    for (const g of games) {
      const box = g.box as HockeyBoxScore;
      for (const shot of box.shots.filter((x) => x[8] === 1)) {
        // A power-play shot happens inside a two-minute penalty the other team took.
        expect(
          box.penalties.some((p) => p[1] !== shot[1] && shot[0] >= p[0] && shot[0] < p[0] + 120),
        ).toBe(true);
      }
      for (const side of [box.home, box.away]) {
        ppGoals += side.skaters.reduce((n, s) => n + s.ppGoals, 0);
        goals += side.skaters.reduce((n, s) => n + s.goals, 0);
        expect(side.skaters.reduce((n, s) => n + s.pim, 0)).toBe(
          box.penalties.filter((p) => box[p[1] === 0 ? 'home' : 'away'] === side).length * 2,
        );
      }
    }
    // Roughly a fifth of goals come on the power play.
    expect(ppGoals / goals).toBeGreaterThan(0.15);
    expect(ppGoals / goals).toBeLessThan(0.3);
  });

  it('plus-minus nets to zero, assists never exceed two a goal, nobody assists his own goal', () => {
    for (const g of games) {
      const box = g.box as HockeyBoxScore;
      const all = [...box.home.skaters, ...box.away.skaters];
      expect(all.reduce((n, p) => n + p.plusMinus, 0)).toBe(0);
      for (const shot of box.shots.filter((s) => s[5] === 1)) {
        expect(shot[6]).not.toBe(shot[4]);
        expect(shot[7]).not.toBe(shot[4]);
        if (shot[7] >= 0) expect(shot[6]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
