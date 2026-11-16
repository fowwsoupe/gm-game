import type { Player, Team, TeamId, TeamStatus } from '@gm/shared';
import { Rng, type LeagueState } from './core';
import { makeSchedule } from './league';
import type { SimContext } from './context';

/** First season of a new league. 2027 = the 2026-27 season. */
export const START_SEASON = 2027;

/**
 * Builds a brand-new league in memory. The data layer saves it.
 * Pass `initial` (from `ctx.sport.importRoster`) to start from a roster file instead of
 * a generated fictional league.
 */
export function createLeague(
  seed: number,
  ctx: SimContext,
  initial?: { season: number; teams: Team[]; players: Player[] },
): LeagueState {
  const rng = new Rng(seed);
  const { teams, players } = initial ?? ctx.sport.generateLeague(rng.fork('league'), ctx.ruleset);
  const season = initial?.season ?? START_SEASON;
  const schedule = makeSchedule(
    season,
    teams,
    ctx.ruleset.season.gamesPerTeam,
    ctx.ruleset.season.calendar.regularSeasonDays,
    rng.fork('schedule'),
  );
  return {
    sport: ctx.sport.id,
    rulesetId: ctx.ruleset.id,
    date: { season, day: 0 },
    rngState: rng.fork('games').state,
    teams: Object.fromEntries(teams.map((t) => [t.id, t])),
    players: Object.fromEntries(players.map((p) => [p.id, p])),
    teamStatus: Object.fromEntries(teams.map((t) => [t.id, 'bubble' as TeamStatus])) as Record<
      TeamId,
      TeamStatus
    >,
    schedule,
    results: {},
    playoffSeries: {},
    championTeamId: null,
    capCharges: [],
    freeAgencyOpen: false,
    draftClass: [],
    draftBoards: {},
    depthCharts: {},
    pickOwners: {},
    tradeOffers: [],
    tradeRequests: [],
    eventSeq: 0,
  };
}
