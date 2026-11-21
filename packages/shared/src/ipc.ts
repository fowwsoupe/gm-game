import type {
  AwardEntry,
  CapSheet,
  CareerLine,
  CoachProfile,
  Department,
  Dashboard,
  DraftPick,
  DraftBoardEntry,
  DraftClock,
  DraftResult,
  GameDetail,
  GameSummary,
  HallOfFamer,
  InternationalTournament,
  LeaderboardView,
  PlayerProfile,
  PlayoffSeries,
  PulseRow,
  RecordEntry,
  ResignOffer,
  RosterPlayer,
  StandingsRow,
  Team,
  LeagueStatus,
  OwnerProfile,
  StaffProfile,
  DepartmentReturns,
  OwnerReport,
  TeamFans,
  SigningInterest,
  TeamId,
  TradeEvaluation,
  FreeAgentOffer,
  PlayerHistory,
  ProspectEntry,
  TradeOffer,
  TradeProposal,
} from './domain';
import type { GoalieRotation } from './sports/hockey';
import type { Command, CommandResult } from './commands';
import type { Importance, LeagueEvent } from './events';
import type { Peer } from './wire';

/**
 * One row of a hosted league's lobby. `key`: the host's number for a guest, which `seat`,
 * `grantAdvance` and `kick` take; only the host's machine has it, and not for the host's own row.
 */
export type SessionPeer = Peer & { key?: string };

/**
 * Where this machine stands online. `you`: this machine's row in `peers` (the host is row 0).
 * `direct`: what a friend types to join. `ended`: why the last session ended by itself: the league
 * this machine was a guest in is over (the host's word, or `disconnected`), or the one it hosted
 * closed on an `error`. Absent after a session its own player ended.
 */
export type SessionStatus =
  | { role: 'none'; ended?: string }
  | {
      role: 'host';
      you: number;
      peers: SessionPeer[];
      direct: { addresses: string[]; port: number; joinCode: string };
    }
  | { role: 'guest'; you: number; peers: SessionPeer[]; reconnecting: boolean };

/** `error`: the engine's or the host's reason, as text (`refused: joinCode`, `disconnected`...). */
export type SessionResult = { ok: true } | { ok: false; error: string };

/**
 * The single contract between the UI (renderer) and the main process.
 * The preload script exposes exactly this object as `window.gm`.
 *
 * Reads are queries (`league.*`, `feed.*`). Every change goes through `commands.dispatch`.
 * Add a query here first, then implement it in main and call it from the UI.
 */
export interface GmApi {
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
    /** Every international tournament played so far, newest first. */
    international(): Promise<InternationalTournament[]>;
    /** Stat leaders of the season so far. */
    leaders(): Promise<LeaderboardView[]>;
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
    /**
     * Player cards for a team's players, or the free agents (`teamId: null`), as `viewer`'s GM
     * sees them (hot-seat: the one at the controls; default the first human team).
     */
    players(input: { teamId: TeamId | null; viewer?: TeamId }): Promise<PlayerProfile[]>;
    /** The lineup a team would dress tonight (healthy players, its depth order), as named units. */
    lines(input: { teamId: TeamId }): Promise<{
      units: { unit: string; playerIds: string[] }[];
      /** Power-play and penalty-kill units (pp1, pp2, pk1, pk2) as games use them. */
      special: Record<string, { playerIds: string[]; custom: boolean }>;
      /** Team chemistry 0–1 and the average seasons together it comes from. */
      chemistry: { value: number; seasons: number; leaders: number };
      /** How well the lines' and pairs' builds complement each other, 0–1 (ice-time weighted). */
      fit: { forwards: number; defense: number };
      /** How much the lines and pairs have played together, 0–1 (ice-time weighted). */
      together: { forwards: number; defense: number };
      /** How the team's goalies share starts. */
      rotation: GoalieRotation;
      /** Players unhappy with their role; `until`: the day a promised role is due. */
      disputes: { playerId: string; until?: number; listed?: true }[];
    }>;
    /** A player's finished regular seasons, oldest first. */
    career(input: { playerId: string }): Promise<CareerLine[]>;
    /** A player's awards and the moves in his career (drafted, signed, traded...). */
    history(input: { playerId: string }): Promise<PlayerHistory>;
    /** Draft picks a team owns in the drafts that can be traded. */
    picks(input: { teamId: TeamId }): Promise<DraftPick[]>;
    /** Players on a team who asked to be traded. */
    tradeRequests(input: { teamId: TeamId }): Promise<string[]>;
    /** A team's owner, AI GM, head coach, department heads, market size (0.65-1.75), arena seats, fans and ticket price step. */
    owner(input: { teamId: TeamId }): Promise<{
      owner: OwnerProfile;
      /** The AI GM's name (null on a human team). */
      gm: string | null;
      coach: CoachProfile;
      /** The assistant GM only on a human team. */
      staff: Record<Exclude<Department, 'assistant'>, StaffProfile> & { assistant?: StaffProfile };
      market: number;
      capacity: number;
      fans: TeamFans;
      ticketPct: number;
    }>;
    /**
     * Who a team can hire for each department this season (`staff.hire` takes the index), and
     * whether it already hired one (once a department a season).
     */
    staffCandidates(input: {
      teamId: TeamId;
    }): Promise<Partial<Record<Department, { candidates: StaffProfile[]; locked: boolean }>>>;
    /**
     * What each department returned last season against an average one: rating points a year
     * added to players 24 or younger, the share of injury time saved (negative: lost), and how
     * far its read of the last draft's picks was off (rating points; null: no picks), with the
     * league's average.
     */
    departmentReturns(input: { teamId: TeamId }): Promise<DepartmentReturns>;
    /** The Owner screen for a team (money flow and meetings come from the event log). */
    ownerReport(input: { teamId: TeamId }): Promise<OwnerReport>;
    /** Offer sheets other teams gave this team's restricted free agents (match or decline). */
    offerSheets(input: { teamId: TeamId }): Promise<FreeAgentOffer[]>;
    /** AI GMs' open offers to a team. */
    tradeOffers(input: { teamId: TeamId }): Promise<TradeOffer[]>;
    /** What the other team would say to a trade, without making it. */
    evaluateTrade(input: TradeProposal): Promise<TradeEvaluation>;
    /**
     * Next draft's class (empty until the champion is crowned), `teamId`'s board, the live
     * draft's picks left (on the clock first) and the latest draft's picks made so far
     * (`made`, by pick; `madeSeason` is that draft's season, null before the first draft).
     */
    draftClass(input: { teamId: TeamId }): Promise<{
      prospects: DraftBoardEntry[];
      board: string[];
      order: DraftClock[];
      made: DraftResult[];
      madeSeason: number | null;
    }>;
    /** A team's prospects (rights held, unsigned), with the scouts' read of `by` (default: his team). */
    prospects(input: { teamId: TeamId; by?: TeamId }): Promise<ProspectEntry[]>;
    /** Home for a team: the to-do list and the next game. */
    dashboard(input: { teamId: TeamId }): Promise<Dashboard>;
    /** Playoff odds, power rating and status for every team. */
    pulse(): Promise<PulseRow[]>;
    /** Date, phase and which windows (trades, free agency) are open. */
    status(): Promise<LeagueStatus>;
    /**
     * How a free agent feels about an offer from `teamId`, or with `resign` one of its own players
     * whose deal ends (null if he is neither).
     */
    signingInterest(input: {
      playerId: string;
      teamId: TeamId;
      salary: number;
      years: number;
      noTrade?: true;
      bonusPct?: number;
      promiseRole?: true;
      resign?: true;
    }): Promise<SigningInterest | null>;
  };
  feed: {
    /**
     * Newest first, with the names and ages of the players they mention (retired ones included)
     * and the story each event belongs to, by event id (`storyOf`).
     */
    list(input: { limit: number; minImportance?: Importance }): Promise<{
      events: LeagueEvent[];
      names: Record<string, string>;
      ages: Record<string, number>;
      stories: Record<string, string>;
    }>;
  };
  commands: {
    /** The only way to change game state. */
    dispatch(command: Command): Promise<CommandResult>;
  };
  steam: {
    status(): Promise<{ enabled: boolean; playerName: string | null }>;
  };
  /**
   * A league played from several machines. The host's game stays the only authority; a guest's
   * queries read a mirror of it and his `commands.dispatch` goes to the host. While a session is
   * open, `newLeague` and `newLeagueFromRoster` are refused.
   */
  session: {
    /** Opens this machine's league to guests over a direct connection (not encrypted: LAN and testing). */
    host(input: { name: string }): Promise<SessionResult>;
    /** Joins the league hosted at `address`: from then on the queries read its mirror. */
    join(input: {
      address: string;
      port: number;
      joinCode: string;
      name: string;
    }): Promise<SessionResult>;
    /** The host ends the session for everyone; a guest goes back to his own league. */
    leave(): Promise<SessionResult>;
    /** A guest's wish for a team: the host decides. */
    requestSeat(input: { teamId: TeamId }): Promise<SessionResult>;
    /** The host binds a guest to a team (an AI team becomes a human one), or to none. */
    seat(input: { key: string; teamId: TeamId | null }): Promise<SessionResult>;
    /** Done for now: advisory, and cleared when the clock moves or an offer arrives. */
    ready(input: { on: boolean }): Promise<SessionResult>;
    /** The host lets a guest move the clock, or takes that back. */
    grantAdvance(input: { key: string; on: boolean }): Promise<SessionResult>;
    /** The host puts a guest out: his seat opens nothing any more and the join code changes. */
    kick(input: { key: string }): Promise<SessionResult>;
    status(): Promise<SessionStatus>;
    /**
     * Main's one push: the league or the lobby changed without this window asking (another GM's
     * command, a guest joining, the session ending). Refetch. Returns the way to stop listening.
     */
    onChanged(listener: () => void): () => void;
  };
}

/** IPC channel names. */
export const IPC = {
  newLeague: 'league:new',
  newLeagueFromRoster: 'league:newFromRoster',
  listTeams: 'league:listTeams',
  standings: 'league:standings',
  playoffs: 'league:playoffs',
  awards: 'league:awards',
  hallOfFame: 'league:hallOfFame',
  international: 'league:international',
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
  offerSheets: 'league:offerSheets',
  history: 'league:history',
  tradeOffers: 'league:tradeOffers',
  tradeRequests: 'league:tradeRequests',
  owner: 'league:owner',
  staffCandidates: 'league:staffCandidates',
  departmentReturns: 'league:departmentReturns',
  ownerReport: 'league:ownerReport',
  evaluateTrade: 'league:evaluateTrade',
  status: 'league:status',
  pulse: 'league:pulse',
  dashboard: 'league:dashboard',
  draftClass: 'league:draftClass',
  prospects: 'league:prospects',
  signingInterest: 'league:signingInterest',
  feedList: 'feed:list',
  dispatch: 'commands:dispatch',
  steamStatus: 'steam:status',
  sessionHost: 'session:host',
  sessionJoin: 'session:join',
  sessionLeave: 'session:leave',
  sessionRequestSeat: 'session:requestSeat',
  sessionSeat: 'session:seat',
  sessionReady: 'session:ready',
  sessionGrantAdvance: 'session:grantAdvance',
  sessionKick: 'session:kick',
  sessionStatus: 'session:status',
  /** Main to the windows, with nothing in it. */
  sessionChanged: 'session:changed',
} as const;
