import type { GameResult, StandingsRow, Team } from './domain';

/**
 * The single contract between the UI (renderer) and the main process.
 * The preload script exposes exactly this object as `window.gm`.
 * Add a method here first, then implement it in main and call it from the UI:
 * TypeScript will flag every side you forgot.
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
  sim: {
    /** Runs in a worker thread so the UI never freezes. */
    simDays(input: { days: number }): Promise<{ results: GameResult[] }>;
  };
  steam: {
    status(): Promise<{ enabled: boolean; playerName: string | null }>;
  };
}

/** IPC channel names, derived so they can't drift from GmApi. */
export const IPC = {
  appVersion: 'app:version',
  newLeague: 'league:new',
  listTeams: 'league:listTeams',
  standings: 'league:standings',
  simDays: 'sim:days',
  steamStatus: 'steam:status',
} as const;
