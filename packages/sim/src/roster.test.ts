import { describe, expect, it } from 'vitest';
import { GOALIE_RATINGS, isGoalie, SKATER_RATINGS } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  exportHockeyRoster,
  handleCommand,
  hockeySeasonStats,
  importHockeyRoster,
  payroll,
  ratingsFromStats,
  Rng,
  statFeatures,
  STATS_TO_RATINGS,
} from './index';

const ctx = defaultContext();
const fictional = () => ctx.sport.generateLeague(new Rng(7).fork('league'), ctx.ruleset);

describe('roster files', () => {
  it('round-trips: export a league, import it back, same players', () => {
    const league = fictional();
    const file = exportHockeyRoster(league, { season: 2027, name: 'Test' });
    const res = importHockeyRoster(JSON.parse(JSON.stringify(file)), ctx.ruleset);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.teams).toHaveLength(league.teams.length);
    expect(res.players).toHaveLength(league.players.length);
    expect(res.players[0]!.ratings).toEqual(league.players[0]!.ratings);
    expect(res.teams[0]!.userControlled).toBe(true);
  });

  it('a loaded roster is a playable league', () => {
    const file = exportHockeyRoster(fictional(), { season: 2031, name: 'Test' });
    // The fictional league starts in 2027: move its contracts to the file's season.
    for (const p of file.players) if (p.contract) p.contract.expiresAfterSeason += 4;
    const res = importHockeyRoster(file, ctx.ruleset);
    if (!res.ok) throw new Error(res.errors.join('\n'));
    const state = createLeague(1, ctx, res);
    expect(state.date.season).toBe(2031);
    const out = handleCommand(
      state,
      { kind: 'sim.advance', days: 10 - state.date.day },
      { id: 'local', controls: [] },
      ctx,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.events.some((e) => e.kind === 'game.final')).toBe(true);
  });

  it('rates a player from one season of stats when the file has no ratings', () => {
    const file = exportHockeyRoster(fictional(), { season: 2027, name: 'Test' });
    const skater = file.players.find((p) => p.skater)!;
    const goalie = file.players.find((p) => p.goalie)!;
    const keep = { skater: skater.skater, goalie: goalie.goalie };
    delete skater.skater;
    delete goalie.goalie;
    skater.stats = { gp: 80, goals: 40, assists: 40, shots: 250, plusMinus: 10, toi: 1500 };
    goalie.stats = { gp: 60, shotsAgainst: 1800, saves: 1650 };
    const res = importHockeyRoster(file, ctx.ruleset);
    if (!res.ok) throw new Error(res.errors.join('\n'));
    const rated = (id: string) => res.players.find((p) => p.id === `p_${id}`)!.ratings;
    expect(Object.keys(rated(skater.id)).sort()).toEqual(Object.keys(keep.skater!).sort());
    expect(Object.keys(rated(goalie.id)).sort()).toEqual(Object.keys(keep.goalie!).sort());
    delete skater.stats; // neither ratings nor stats: rejected
    expect(importHockeyRoster(file, ctx.ruleset).ok).toBe(false);
  });

  it('rejects bad files with readable errors', () => {
    expect(importHockeyRoster({ hello: 'world' }, ctx.ruleset).ok).toBe(false);
    const file = exportHockeyRoster(fictional(), { season: 2027, name: 'Test' });
    file.players[0]!.team = 'ZZZ';
    const res = importHockeyRoster(file, ctx.ruleset);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/Unknown team ZZZ/);
  });

  it('rejects a team with no goalie', () => {
    const file = exportHockeyRoster(fictional(), { season: 2027, name: 'Test' });
    const abbr = file.teams[1]!.abbreviation;
    file.players = file.players.filter((p) => !(p.team === abbr && p.position === 'G'));
    const res = importHockeyRoster(file, ctx.ruleset);
    expect(res.ok).toBe(false);
  });

  it('gives every generated player exactly the rating keys of his position', () => {
    for (const p of fictional().players) {
      const keys = isGoalie(p.position) ? GOALIE_RATINGS : SKATER_RATINGS;
      expect(Object.keys(p.ratings).sort()).toEqual([...keys].sort());
    }
  });

  it('upgrades a v1 file: faceoffs start at the average of the other skater ratings', () => {
    const file = JSON.parse(
      JSON.stringify(exportHockeyRoster(fictional(), { season: 2027, name: 'Old' })),
    );
    file.formatVersion = 1;
    for (const p of file.players) if (p.skater) delete p.skater.faceoffs;
    const skater = file.players.find((p: { skater?: object }) => p.skater);
    const others = Object.values(skater.skater as Record<string, number>);
    const res = importHockeyRoster(file, ctx.ruleset);
    if (!res.ok) throw new Error(res.errors.join('\n'));
    const loaded = res.players.find((p) => p.id === `p_${skater.id}`)!;
    expect(loaded.ratings.faceoffs).toBe(
      Math.round(others.reduce((a, b) => a + b, 0) / others.length),
    );
    expect(file.formatVersion).toBe(1); // the caller's object is not changed
  });

  it('generates payrolls legal under the ruleset it is given, not a fixed cap', () => {
    const tight = { ...ctx.ruleset, cap: { ...ctx.ruleset.cap, upperLimit: 60_000_000 } };
    const league = ctx.sport.generateLeague(new Rng(7).fork('league'), tight);
    for (const team of league.teams) {
      const roster = league.players.filter((p) => p.teamId === team.id);
      expect(payroll(roster)).toBeLessThanOrEqual(tight.cap.upperLimit);
    }
  });

  it('rejects contracts the league rules forbid, with readable lines', () => {
    const file = exportHockeyRoster(fictional(), { season: 2027, name: 'Test' });
    file.players[0]!.contract = { capHit: 30_000_000, expiresAfterSeason: 2028 };
    file.players[1]!.contract = { capHit: 1_000_000, expiresAfterSeason: 2040 };
    file.players[2]!.contract = { capHit: 1_000_000, expiresAfterSeason: 2025 };
    const res = importHockeyRoster(file, ctx.ruleset);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors).toEqual([
        'players.0.contract: cap hit is above the maximum of $20.80M',
        'players.1.contract: runs longer than the 7-season maximum',
        'players.2.contract: ended before the 2027 season',
      ]);
    }
  });
});

describe('stats to ratings', () => {
  const games = ctx.ruleset.season.gamesPerTeam;

  it('falls back to the position average and its full spread with no games', () => {
    const est = ratingsFromStats(
      STATS_TO_RATINGS,
      'C',
      { gp: 0, goals: 0, assists: 0, shots: 0, plusMinus: 0, toi: 0 },
      games,
    );
    const fit = STATS_TO_RATINGS.groups.F.shooting!;
    expect(est.shooting).toEqual({
      value: Math.round(fit.mean),
      sd: Math.round(10 * fit.priorSd) / 10,
    });
    const goalie = ratingsFromStats(
      STATS_TO_RATINGS,
      'G',
      { gp: 0, shotsAgainst: 0, saves: 0 },
      games,
    );
    expect(goalie.reflexes!.value).toBe(Math.round(STATS_TO_RATINGS.groups.G.reflexes!.mean));
  });

  it('recovers ratings from a season it was not fitted on, with honest uncertainty', () => {
    const state = createLeague(3, ctx); // the fit uses seeds 10000+
    handleCommand(
      state,
      { kind: 'sim.advance', days: ctx.ruleset.season.calendar.regularSeasonDays },
      { id: 'local', controls: [] },
      ctx,
    );
    const { skaters, goalies } = hockeySeasonStats(Object.values(state.results));
    const pairs: [number, number][] = [];
    let within = 0;
    let total = 0;
    for (const p of Object.values(state.players)) {
      const totals = skaters.get(p.id) ?? goalies.get(p.id);
      if (!totals || statFeatures(p.position, totals, games).share < 1) continue;
      const est = ratingsFromStats(STATS_TO_RATINGS, p.position, totals, games);
      for (const [key, e] of Object.entries(est)) {
        total++;
        if (Math.abs(e.value - p.ratings[key]!) <= 2 * e.sd) within++;
      }
      if (!isGoalie(p.position)) pairs.push([est.shooting!.value, p.ratings.shooting!]);
    }
    const r = (() => {
      const m = (k: 0 | 1) => pairs.reduce((s, x) => s + x[k], 0) / pairs.length;
      const [ma, mb] = [m(0), m(1)];
      const cov = pairs.reduce((s, [a, b]) => s + (a - ma) * (b - mb), 0);
      const va = pairs.reduce((s, [a]) => s + (a - ma) ** 2, 0);
      const vb = pairs.reduce((s, [, b]) => s + (b - mb) ** 2, 0);
      return cov / Math.sqrt(va * vb);
    })();
    expect(r).toBeGreaterThan(0.75); // shooting: the best-measured skater rating
    expect(within / total).toBeGreaterThan(0.9); // ±2 sd covers ~95% if the sd is honest
  });
});
