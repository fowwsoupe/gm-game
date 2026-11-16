import type {
  AwardEntry,
  CapSheet,
  Leaderboard,
  PlayoffSeries,
  RecordEntry,
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
  feedList: 'feed:list',
  dispatch: 'commands:dispatch',
  steamStatus: 'steam:status',
} as const;
