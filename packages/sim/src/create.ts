import type { Player, Team, TeamId, TeamStatus } from '@gm/shared';
import { STOP_CATEGORIES } from '@gm/shared';
import { Rng, type LeagueState } from './core';
import { drawForm, makeSchedule } from './league';
import { newCoach, randomGm } from './people';
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
    // Opens with camp, like every season after it.
    date: { season, day: -ctx.ruleset.season.calendar.preseasonDays },
    rngState: rng.fork('games').state,
    teams: Object.fromEntries(
      teams.map((t, i) => {
        const r = rng.fork(`coach${i}`);
        const { years } = ctx.ruleset.finance.coach;
        // Coaches hired over the last few seasons, so their deals do not all end together.
        const coach =
          t.coach ?? newCoach(r, season - Math.floor(r.next() * years), ctx.ruleset.finance.coach);
        return [t.id, { ...t, gm: t.gm ?? randomGm(rng.fork(`gm${i}`)), coach }];
      }),
    ),
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
    draftOrder: [],
    draftBoards: {},
    draftPicksMade: null,
    depthCharts: {},
    trainingPlans: {},
    international: [],
    specialUnits: {},
    pickOwners: {},
    pickProtection: {},
    tradeOffers: [],
    seasonTrades: [],
    tradeRequests: [],
    holdouts: [],
    breakouts: {},
    disputes: [],
    linemates: {},
    cash: {},
    fans: {},
    ticketPrices: {},
    owners: {},
    ownerCards: [],
    projects: [],
    arenas: {},
    career: null,
    canBeFired: true,
    stopOn: [...STOP_CATEGORIES],
    faOffers: [],
    marketDay: 0,
    rfaRights: {},
    formerTeams: {},
    goalieRotation: {},
    tradeBlock: [],
    rfaSheets: [],
    teamForm: drawForm(
      teams.map((t) => t.id),
      ctx.ruleset.season.form,
      rng.fork('form'),
    ),
    lastSeason: {},
    eventSeq: 0,
  };
}
