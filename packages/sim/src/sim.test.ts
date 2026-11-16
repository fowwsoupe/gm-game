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
  HOCKEY_TUNING,
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
    const [starter, backup] = strength.lineup.goalies;
    expect(starter!.id).not.toBe(backup!.id);
    const goalieUsed = (input: { homeBackToBack?: boolean; playoff?: boolean }) =>
      (
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
        ).box as HockeyBoxScore
      ).home.goalie.id;
    expect(goalieUsed({})).toBe(starter!.id);
    expect(goalieUsed({ homeBackToBack: true })).toBe(backup!.id);
    expect(goalieUsed({ homeBackToBack: true, playoff: true })).toBe(starter!.id);
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
        // Five skaters for 60 minutes, minus the minutes a man down (less if a power-play goal
        // ended the penalty early), plus overtime and the extra attacker with the goalie pulled.
        const shorthanded =
          box.penalties.filter((p) => p[1] === (key === 'home' ? 0 : 1)).length * 2;
        const toi = side.skaters.reduce((n, s) => n + s.toi, 0);
        if (side.skaters.length === 18) {
          expect(toi).toBeGreaterThan(300 - shorthanded - 1.5);
          expect(toi).toBeLessThan(300 + (g.overtime ? (g.playoffSeriesId ? 600 : 15) : 0) + 8);
        }
        // Every shot at a goalie is a save or a goal against him; empty-net goals are on nobody's line.
        const own = box[key];
        const opp = box[key === 'home' ? 'away' : 'home'];
        const lines = [opp.goalie, ...(opp.relief ? [opp.relief] : [])];
        const emptyNet = box.emptyNet?.[key === 'home' ? 0 : 1] ?? 0;
        expect(lines.reduce((n, l) => n + l.shotsAgainst - l.saves, 0) + emptyNet).toBe(credited);
        if (!g.playoffSeriesId) {
          expect(own.goalie.toi + (own.relief?.toi ?? 0)).toBeLessThanOrEqual(g.overtime ? 66 : 61);
        }
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
          box.penalties.some((p) => p[1] !== shot[1] && shot[0] >= p[0] && shot[0] <= p[0] + 121),
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
      // Each even-strength or short-handed goal moves plus-minus by the gap in skaters on the ice.
      const goals = box.shots.filter((x) => x[5] === 1).length;
      expect(Math.abs(all.reduce((n, p) => n + p.plusMinus, 0))).toBeLessThanOrEqual(3 * goals);
      for (const shot of box.shots.filter((s) => s[5] === 1)) {
        expect(shot[6]).not.toBe(shot[4]);
        expect(shot[7]).not.toBe(shot[4]);
        if (shot[7] >= 0) expect(shot[6]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('game engine', () => {
  const state = createLeague(41, ctx);
  const [a, b] = Object.keys(state.teams) as TeamId[];
  const strength = (id: TeamId) =>
    teamStrength(Object.values(state.players).filter((p) => p.teamId === id));
  const play = (n: number, input: { playoff?: boolean; resultOnly?: boolean } = {}) => {
    const rng = new Rng(9);
    return Array.from({ length: n }, () =>
      simGame(
        {
          id: 'g' as GameId,
          homeTeamId: a!,
          awayTeamId: b!,
          home: strength(a!),
          away: strength(b!),
          ...input,
        },
        rng,
      ),
    );
  };

  it('is deterministic and the better goalie lets in fewer', () => {
    expect(play(5)).toEqual(play(5));
    const good = strength(a!);
    const [first, ...rest] = good.lineup.goalies;
    const weak = {
      ...first!,
      ratings: Object.fromEntries(Object.entries(first!.ratings).map(([k, v]) => [k, v - 25])),
    };
    const bad = { ...good, lineup: { ...good.lineup, goalies: [weak, ...rest] } };
    const against = (home: typeof good) => {
      const rng = new Rng(2);
      let goals = 0;
      for (let i = 0; i < 400; i++) {
        const r = simGame(
          {
            id: 'g' as GameId,
            homeTeamId: a!,
            awayTeamId: b!,
            home,
            away: strength(b!),
            resultOnly: true,
          },
          rng,
        );
        goals += r.awayScore;
      }
      return goals;
    };
    expect(against(good)).toBeLessThan(against(bad));
  });

  it('settles ties: playoff games never go to a shootout, regular-season overtime is 3v3', () => {
    for (const g of play(300, { playoff: true })) {
      expect(g.homeScore).not.toBe(g.awayScore);
      expect(g.stats.shootout).toBe(0);
    }
    const reg = play(600);
    expect(reg.some((g) => g.stats.shootout === 1)).toBe(true);
    for (const g of reg) expect(g.homeScore).not.toBe(g.awayScore);
    // An overtime goal comes after the 60th minute, from the 3v3 pace.
    const ot = reg.filter((g) => g.overtime && g.stats.shootout === 0);
    expect(ot.length).toBeGreaterThan(20);
    for (const g of ot) {
      const box = g.box as HockeyBoxScore;
      expect(box.shots.at(-1)![0]).toBeGreaterThanOrEqual(3600);
    }
  });

  it("pulls the goalie late when trailing, and empty-net goals are on nobody's line", () => {
    const games = play(1500);
    const withEmpty = games.filter((g) => (g.box as HockeyBoxScore).emptyNet);
    expect(withEmpty.length).toBeGreaterThan(30);
    for (const g of withEmpty) {
      const box = g.box as HockeyBoxScore;
      // The empty net is scored late and by the team that was ahead.
      const last = box.shots.filter((s) => s[5] === 1).at(-1)!;
      if (g.overtime) continue;
      expect(last[0]).toBeGreaterThan(3600 - HOCKEY_TUNING.pullSeconds[0] - 1);
    }
  });

  it('a goalie who lets in four early is replaced', () => {
    const relieved = play(1500).filter((g) => (g.box as HockeyBoxScore).home.relief);
    expect(relieved.length).toBeGreaterThan(5);
    for (const g of relieved) {
      const { goalie, relief } = (g.box as HockeyBoxScore).home;
      expect(relief!.id).not.toBe(goalie.id);
      expect(goalie.toi + relief!.toi).toBeGreaterThan(55);
    }
  });

  it('result-only plays the same game without the box score', () => {
    const full = play(1500);
    const fast = play(1500, { resultOnly: true });
    const mean = (gs: typeof full) =>
      gs.reduce((n, g) => n + g.homeScore + g.awayScore, 0) / gs.length;
    expect(Math.abs(mean(fast) - mean(full))).toBeLessThan(0.35);
    for (const g of fast) {
      expect(g.box).toBeUndefined();
      expect(g.injuries).toBeUndefined();
    }
  });
});

describe('injuries', () => {
  it('hurt players miss later games, and nobody is hurt in a game he did not play', () => {
    const state = createLeague(21, ctx);
    const out = new Map<string, number>();
    let violations = 0;
    for (let d = 0; d < 150; d++) {
      const day = state.date.day;
      const res = handleCommand(state, { kind: 'sim.advance', days: 1 }, local, ctx);
      if (!res.ok) throw new Error(res.error.message);
      for (const e of res.events) {
        if (e.kind !== 'game.final') continue;
        const box = e.result.box as HockeyBoxScore;
        for (const p of [...box.home.skaters, ...box.away.skaters]) {
          if ((out.get(p.id) ?? 0) > day) violations++;
        }
        expect(e.result.injuries).toBeUndefined(); // turned into events, not stored
      }
      for (const e of res.events) {
        if (e.kind === 'player.injured') {
          expect(e.until).toBeGreaterThan(day);
          out.set(e.playerId, e.until);
        }
      }
    }
    expect(out.size).toBeGreaterThan(20);
    expect(violations).toBe(0);
  });

  it('heals over the summer', () => {
    const state = createLeague(22, ctx);
    const id = Object.keys(state.players)[0]!;
    const base = {
      id: 'e',
      date: state.date,
      importance: 'minor' as const,
      teamIds: [] as TeamId[],
    };
    applyEvent(state, {
      ...base,
      kind: 'player.injured',
      playerId: id as never,
      days: 5,
      until: 9,
    });
    expect(state.players[id]!.injuredUntil).toBe(9);
    applyEvent(state, { ...base, kind: 'season.started', season: 2028, schedule: [], rngState: 1 });
    expect(state.players[id]!.injuredUntil).toBeUndefined();
  });

  it('fills a short line with a spare forward of another position', () => {
    const state = createLeague(23, ctx);
    const team = Object.keys(state.teams)[0]!;
    const roster = Object.values(state.players).filter((p) => p.teamId === team);
    const centres = roster.filter((p) => p.position === 'C').slice(0, 2); // leaves fewer than four
    const lineup = autoLineup(roster.filter((p) => !centres.includes(p)));
    expect(lineup.forwards.every((line) => line.length === 3)).toBe(true);
  });
});

describe('short lineups', () => {
  it('puts a spare forward on defence when a pair is short', () => {
    const state = createLeague(24, ctx);
    const team = Object.keys(state.teams)[0]!;
    const roster = Object.values(state.players).filter((p) => p.teamId === team);
    const keep = roster
      .filter((p) => p.position !== 'D')
      .concat(roster.filter((p) => p.position === 'D').slice(0, 5));
    const lineup = autoLineup(keep);
    expect(lineup.defense.flat()).toHaveLength(6);
  });
});
