import type {
  AwardEntry,
  CapSheet,
  CareerLine,
  Dashboard,
  DraftPick,
  DraftBoardEntry,
  GameDetail,
  GameSummary,
  HallOfFamer,
  Leaderboard,
  PlayerProfile,
  PlayoffSeries,
  PulseRow,
  RecordEntry,
  ResignOffer,
  RosterPlayer,
  StandingsRow,
  Team,
  LeagueStatus,
  SigningInterest,
  TeamId,
  TradeEvaluation,
  TradeProposal,
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
    /** Retired players in the Hall of Fame, most recent first. */
    hallOfFame(): Promise<HallOfFamer[]>;
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
    /** Player cards for a team's players, or the free agents (`teamId: null`). */
    players(input: { teamId: TeamId | null }): Promise<PlayerProfile[]>;
    /** The lineup a team would dress tonight (healthy players, its depth order), as named units. */
    lines(input: { teamId: TeamId }): Promise<{ unit: string; playerIds: string[] }[]>;
    /** A player's finished regular seasons, oldest first. */
    career(input: { playerId: string }): Promise<CareerLine[]>;
    /** Draft picks a team owns in the drafts that can be traded. */
    picks(input: { teamId: TeamId }): Promise<DraftPick[]>;
    /** What the other team would say to a trade, without making it. */
    evaluateTrade(input: TradeProposal): Promise<TradeEvaluation>;
    /** Next draft's class (empty until the champion is crowned) and `teamId`'s board. */
    draftClass(input: {
      teamId: TeamId;
    }): Promise<{ prospects: DraftBoardEntry[]; board: string[] }>;
    /** Home for a team: the to-do list and the next game. */
    dashboard(input: { teamId: TeamId }): Promise<Dashboard>;
    /** Playoff odds, power rating and status for every team. */
    pulse(): Promise<PulseRow[]>;
    /** Date, phase and which windows (trades, free agency) are open. */
    status(): Promise<LeagueStatus>;
    /** How a free agent feels about an offer from `teamId` (null if he is not a free agent). */
    signingInterest(input: {
      playerId: string;
      teamId: TeamId;
      salary: number;
      years: number;
    }): Promise<SigningInterest | null>;
  };
  feed: {
    /** Newest first, with the names of the players they mention (retired ones included). */
    list(input: {
      limit: number;
      minImportance?: Importance;
    }): Promise<{ events: LeagueEvent[]; names: Record<string, string> }>;
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
  hallOfFame: 'league:hallOfFame',
  records: 'league:records',
  leaders: 'league:leaders',
  capSheet: 'league:capSheet',
  roster: 'league:roster',
  games: 'league:games',
  game: 'league:game',
  exhibition: 'league:exhibition',
  resignOffers: 'league:resignOffers',
  players: 'league:players',
  career: 'league:career',
  lines: 'league:lines',
  picks: 'league:picks',
  evaluateTrade: 'league:evaluateTrade',
  status: 'league:status',
  pulse: 'league:pulse',
  dashboard: 'league:dashboard',
  draftClass: 'league:draftClass',
  signingInterest: 'league:signingInterest',
  feedList: 'feed:list',
  dispatch: 'commands:dispatch',
  steamStatus: 'steam:status',
} as const;
