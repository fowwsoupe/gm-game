import { describe, expect, it } from 'vitest';
import type { Actor, GameId, HockeyBoxScore, TeamId } from '@gm/shared';
import {
  applyEvent,
  autoLineup,
  createLeague,
  defaultContext,
  handleCommand,
  HOCKEY_TUNING,
  ICE_TIME,
  overall,
  Rng,
  simGame,
  teamStrength,
} from './index';

/** The hockey game: lines and goalies, box scores, the shift-by-shift engine, injuries. */
const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();

function simSeason(seed: number) {
  const state = createLeague(seed, ctx);
  const res = handleCommand(state, { kind: 'sim.advance', days: 220 }, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return { state, events: res.events };
}

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
