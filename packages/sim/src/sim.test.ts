import { describe, expect, it } from 'vitest';
import type { GameResult, TeamId } from '@gm/shared';
import {
  computeStandings,
  generateFictionalLeague,
  roundRobinSchedule,
  Rng,
  simGame,
  teamStrength,
} from './index';

function simSeason(seed: number) {
  const rng = new Rng(seed);
  const { teams, players } = generateFictionalLeague(rng.fork('league'));
  const strength = new Map(
    teams.map((t) => [t.id, teamStrength(players.filter((p) => p.teamId === t.id))]),
  );
  const schedule = roundRobinSchedule(
    teams.map((t) => t.id),
    82,
    rng.fork('schedule'),
  );
  const gameRng = rng.fork('games');
  const results: GameResult[] = schedule.map((g) =>
    simGame(
      { ...g, home: strength.get(g.homeTeamId)!, away: strength.get(g.awayTeamId)! },
      gameRng,
    ),
  );
  return { teams, results };
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
  it('gives identical results for the same seed', () => {
    expect(simSeason(7).results).toEqual(simSeason(7).results);
  });

  it('every game has a winner', () => {
    for (const g of simSeason(3).results) expect(g.homeGoals).not.toEqual(g.awayGoals);
  });

  it('scoring lands in a realistic NHL range', () => {
    const { results } = simSeason(11);
    const goalsPerTeamGame =
      results.reduce((s, g) => s + g.homeGoals + g.awayGoals, 0) / (results.length * 2);
    expect(goalsPerTeamGame).toBeGreaterThan(2.5);
    expect(goalsPerTeamGame).toBeLessThan(3.8);
  });

  it('standings points add up', () => {
    const { teams, results } = simSeason(5);
    const rows = computeStandings(
      teams.map((t) => t.id as TeamId),
      results,
    );
    const totalGp = rows.reduce((s, r) => s + r.gp, 0);
    expect(totalGp).toBe(results.length * 2);
    expect(rows[0]!.pts).toBeGreaterThanOrEqual(rows[rows.length - 1]!.pts);
  });
});
