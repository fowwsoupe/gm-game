import type {
  GameDate,
  GameResult,
  LeagueEvent,
  PlayoffSeries,
  Player,
  ScheduledGame,
  Sport,
  Team,
  TeamId,
  TeamStatus,
} from '@gm/shared';

export type { ScheduledGame };

/**
 * The whole league as plain data, held in memory while a save is open.
 * The data layer loads it from SQLite and persists changes; the sim only ever reads it
 * and returns events. State changes happen in exactly one place: `applyEvent` (reducer).
 *
 * Keep it serializable (no classes, no functions): it crosses into the sim worker.
 */
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
  playoffSeries: Record<string, PlayoffSeries>;
  championTeamId: TeamId | null;
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
      if (event.result.playoffSeriesId) {
        const series = state.playoffSeries[event.result.playoffSeriesId];
        if (!series) throw new Error(`unknown playoff series ${event.result.playoffSeriesId}`);
        const winner =
          event.result.homeScore > event.result.awayScore
            ? event.result.homeTeamId
            : event.result.awayTeamId;
        if (winner === series.higherTeamId) series.higherWins++;
        else if (winner === series.lowerTeamId) series.lowerWins++;
        else throw new Error('playoff winner not in series');
      }
      return;
    case 'series.started':
      state.playoffSeries[event.series.id] = { ...event.series };
      return;
    case 'series.won':
      state.playoffSeries[event.seriesId]!.winnerTeamId = event.winnerTeamId;
      return;
    case 'champion.crowned':
      state.championTeamId = event.championTeamId;
      return;
    case 'players.developed':
      for (const c of event.changes) {
        const p = state.players[c.playerId];
        if (!p) throw new Error(`unknown player ${c.playerId}`);
        p.ratings = { ...c.ratings };
        p.potential = c.potential;
      }
      return;
    case 'player.retired':
      delete state.players[event.playerId];
      return;
    case 'contract.expired': {
      const p = state.players[event.playerId];
      if (!p) throw new Error(`unknown player ${event.playerId}`);
      p.teamId = null;
      delete p.contract;
      return;
    }
    case 'player.drafted':
      state.players[event.player.id] = structuredClone(event.player);
      return;
    case 'player.signed': {
      const p = state.players[event.playerId];
      if (!p) throw new Error(`unknown player ${event.playerId}`);
      p.teamId = event.teamId;
      p.contract = { ...event.contract };
      return;
    }
    case 'season.started':
      state.date = { season: event.season, day: 0 };
      state.rngState = event.rngState;
      state.schedule = event.schedule.map((g) => ({ ...g, date: { ...g.date } }));
      state.results = {};
      state.playoffSeries = {};
      state.championTeamId = null;
      return;
    case 'team.statusChanged':
      state.teamStatus[event.teamId] = event.to;
      return;
    case 'award.given':
    case 'season.phaseChanged':
    case 'news.posted':
      return; // informational; no state change
    default: {
      const unhandled: never = event;
      throw new Error(`applyEvent: unhandled event ${(unhandled as LeagueEvent).kind}`);
    }
  }
}
