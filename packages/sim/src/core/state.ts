import type {
  GameDate,
  GameResult,
  LeagueEvent,
  Player,
  Sport,
  Team,
  TeamId,
  TeamStatus,
} from '@gm/shared';

/**
 * The whole league as plain data, held in memory while a save is open.
 * The data layer loads it from SQLite and persists changes; the sim only ever reads it
 * and returns events. State changes happen in exactly one place: `applyEvent` (reducer).
 *
 * Keep it serializable (no classes, no functions): it crosses into the sim worker.
 */
export interface ScheduledGame {
  id: string;
  date: GameDate;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
}

export interface LeagueState {
  sport: Sport;
  rulesetId: string;
  date: GameDate;
  /** Seeded RNG position, so the next sim continues exactly where the last stopped. */
  rngState: number;
  teams: Record<TeamId, Team>;
  players: Record<string, Player>;
  teamStatus: Record<TeamId, TeamStatus>;
  schedule: ScheduledGame[];
  /** Results of the current season only; older seasons are archived by the data layer. */
  results: Record<string, GameResult>;
  /** Count of events applied so far; the next event's id is built from it. */
  eventSeq: number;
}

/**
 * The single reducer: how each event changes state. Pure and synchronous.
 * Replaying the same events on the same starting state gives the same league.
 */
export function applyEvent(state: LeagueState, event: LeagueEvent): void {
  // Every applied event advances the sequence, in every copy of the state, so ids stay in sync.
  state.eventSeq++;
  switch (event.kind) {
    case 'clock.advanced':
      state.date = event.to;
      state.rngState = event.rngState;
      return;
    case 'team.controlChanged': {
      const team = state.teams[event.teamId];
      if (team) team.userControlled = event.userControlled;
      return;
    }
    case 'game.final':
      state.results[event.result.id] = event.result;
      return;
    case 'team.statusChanged':
      state.teamStatus[event.teamId] = event.to;
      return;
    case 'season.phaseChanged':
    case 'news.posted':
      return; // informational; no state change
    default: {
      const unhandled: never = event;
      throw new Error(`applyEvent: unhandled event ${(unhandled as LeagueEvent).kind}`);
    }
  }
}
