import { describe, expect, it } from 'vitest';
import type { Actor, TeamId } from '@gm/shared';
import {
  computeStandings,
  createLeague,
  defaultContext,
  handleCommand,
  playoffOdds,
  raceNight,
  Rng,
  teamRatings,
  type LeagueState,
} from './index';

const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();

const odds = (state: LeagueState, seed = 1) =>
  playoffOdds({
    teams: Object.values(state.teams),
    schedule: state.schedule,
    results: Object.values(state.results),
    ruleset: ctx.ruleset,
    season: state.date.season,
    exponent: 2,
    rng: new Rng(seed),
    sims: 400,
  });

describe('playoff odds', () => {
  it('add up to the playoff spots and are certain once the season is over', () => {
    const state = createLeague(41, ctx);
    const start = odds(state);
    const sum = [...start.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(ctx.ruleset.playoffs.teamsQualifying, 5);
    for (const p of start.values()) expect(p).toBeGreaterThan(0.05);

    handleCommand(state, { kind: 'sim.advance', days: 120 }, local, ctx);
    const mid = odds(state);
    const rows = computeStandings(
      Object.keys(state.teams) as TeamId[],
      Object.values(state.results),
      ctx.ruleset.season.points,
    );
    // The leader is more likely in than the last-place team.
    expect(mid.get(rows[0]!.teamId)!).toBeGreaterThan(mid.get(rows.at(-1)!.teamId)!);
    expect(odds(state, 1)).toEqual(odds(state, 1));

    handleCommand(
      state,
      { kind: 'sim.advance', days: ctx.ruleset.season.calendar.regularSeasonDays - 120 },
      local,
      ctx,
    );
    const end = odds(state);
    const inTeams = new Set(
      Object.values(state.playoffSeries).flatMap((s) => [s.higherTeamId, s.lowerTeamId]),
    );
    for (const [id, p] of end) expect(p).toBe(inTeams.has(id) ? 1 : 0);
  });

  it('rates a team that scores more and allows less higher', () => {
    const ratings = teamRatings(
      [
        { teamId: 'a' as TeamId, gp: 10, w: 8, l: 2, otl: 0, pts: 16, gf: 40, ga: 20 },
        { teamId: 'b' as TeamId, gp: 10, w: 2, l: 8, otl: 0, pts: 4, gf: 20, ga: 40 },
      ],
      2,
    );
    expect(ratings.get('a' as TeamId)!).toBeGreaterThan(0.5);
    expect(ratings.get('b' as TeamId)!).toBeLessThan(0.5);
  });
});

describe('race night', () => {
  it('a win helps your odds and a loss hurts them', () => {
    const state = createLeague(42, ctx);
    handleCommand(state, { kind: 'sim.advance', days: 150 }, local, ctx);
    const teamId = Object.keys(state.teams)[3] as TeamId;
    const night = raceNight({
      teams: Object.values(state.teams),
      schedule: state.schedule,
      results: Object.values(state.results),
      ruleset: ctx.ruleset,
      season: state.date.season,
      exponent: 2,
      sims: 400,
      teamId,
      seed: 3,
    });
    expect(night).not.toBeNull();
    expect(night!.ifWin).toBeGreaterThanOrEqual(night!.ifLose);
  });
});
