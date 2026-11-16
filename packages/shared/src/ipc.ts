import type {
  AwardEntry,
  CapSheet,
  GameDetail,
  GameSummary,
  Leaderboard,
  PlayoffSeries,
  RecordEntry,
  ResignOffer,
  RosterPlayer,
  StandingsRow,
  Team,
  TeamId,
} from './domain';
import type { Command, CommandResult } from './commands';
import type { Importance, LeagueEvent } from './events';

/**
 * The single contract between the UI (renderer) and the main process.
 * The preload script exposes exactly this object as `window.gm`.
 *
 * Reads are queries (`league.*`, `feed.*`). Every change goes through `commands.dispatch`.
 * Add a query here first, then implement it in main and call it from the UI.
 */
export interface GmApi {
  app: {
    version(): Promise<string>;
  };
  league: {
    newLeague(input: { seed: number }): Promise<{ teams: Team[] }>;
    /** Opens a file picker for a roster JSON file and starts a league from it. */
    newLeagueFromRoster(input: {
      seed: number;
    }): Promise<{ ok: true; teams: Team[] } | { ok: false; errors: string[] } | { ok: 'canceled' }>;
    listTeams(): Promise<Team[]>;
    standings(): Promise<StandingsRow[]>;
    playoffs(): Promise<{ series: PlayoffSeries[]; championTeamId: TeamId | null }>;
    /** Every award given so far, newest season first. */
    awards(): Promise<AwardEntry[]>;
    /** Stat leaders of the season so far. */
    leaders(): Promise<Leaderboard[]>;
    /** Team records over all finished seasons. */
    records(): Promise<RecordEntry[]>;
    /** A team's cap sheet: the cap year in play, then future seasons. */
    capSheet(input: { teamId: TeamId }): Promise<CapSheet>;
    /** Finished games of this season, newest first (one team's, or everyone's). */
    games(input: { teamId?: TeamId; limit: number }): Promise<GameSummary[]>;
    /** One finished game with its box score, or null if it is not in this season. */
    game(input: { id: string }): Promise<GameDetail | null>;
    /**
     * Plays any two teams once, as they are today, and returns the game. Changes nothing: the
     * same seed gives the same game, a new seed a new one.
     */
    exhibition(input: {
      homeTeamId: TeamId;
      awayTeamId: TeamId;
      seed: number;
    }): Promise<GameDetail>;
    /** A team's players under contract or expiring, for names on the cap sheet. */
    roster(input: { teamId: TeamId }): Promise<RosterPlayer[]>;
    /** Expiring players a team may re-sign now (empty until the champion is crowned). */
    resignOffers(input: { teamId: TeamId }): Promise<ResignOffer[]>;
  };
  feed: {
    list(input: { limit: number; minImportance?: Importance }): Promise<LeagueEvent[]>;
  };
  commands: {
    /** The only way to change game state. */
    dispatch(command: Command): Promise<CommandResult>;
  };
  steam: {
    status(): Promise<{ enabled: boolean; playerName: string | null }>;
  };
}

/** IPC channel names. */
export const IPC = {
  appVersion: 'app:version',
  newLeague: 'league:new',
  newLeagueFromRoster: 'league:newFromRoster',
  listTeams: 'league:listTeams',
  standings: 'league:standings',
  playoffs: 'league:playoffs',
  awards: 'league:awards',
  records: 'league:records',
  leaders: 'league:leaders',
  capSheet: 'league:capSheet',
  roster: 'league:roster',
  games: 'league:games',
  game: 'league:game',
  exhibition: 'league:exhibition',
  resignOffers: 'league:resignOffers',
  feedList: 'feed:list',
  dispatch: 'commands:dispatch',
  steamStatus: 'steam:status',
} as const;
