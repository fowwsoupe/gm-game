import type { StandingsRow, Team } from './domain';
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
    listTeams(): Promise<Team[]>;
    standings(): Promise<StandingsRow[]>;
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
  listTeams: 'league:listTeams',
  standings: 'league:standings',
  feedList: 'feed:list',
  dispatch: 'commands:dispatch',
  steamStatus: 'steam:status',
} as const;
