import type { TeamId, TeamStatus } from '@gm/shared';
import { Rng, type LeagueState } from './core';
import { roundRobinSchedule } from './league';
import type { SimContext } from './context';

/** First season of a new league. 2027 = the 2026-27 season. */
export const START_SEASON = 2027;

/** Builds a brand-new league in memory. The data layer saves it. */
export function createLeague(seed: number, ctx: SimContext): LeagueState {
  const rng = new Rng(seed);
  const { teams, players } = ctx.sport.generateLeague(rng.fork('league'));
  const schedule = roundRobinSchedule(
    START_SEASON,
    teams.map((t) => t.id),
    ctx.ruleset.season.gamesPerTeam,
    rng.fork('schedule'),
  );
  return {
    sport: ctx.sport.id,
    rulesetId: ctx.ruleset.id,
    date: { season: START_SEASON, day: 0 },
    rngState: rng.fork('games').state,
    teams: Object.fromEntries(teams.map((t) => [t.id, t])),
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    teamStatus: Object.fromEntries(teams.map((t) => [t.id, 'bubble' as TeamStatus])) as Record<
      TeamId,
      TeamStatus
    >,
    schedule,
    results: {},
    eventSeq: 0,
  };
}
