/**
 * Core domain types shared by every sport. Nothing here is hockey-, basketball- or
 * football-specific: positions and ratings are open shapes that each sport module types
 * (see ./sports/hockey.ts). We start with the NHL only; NBA and NFL reuse everything here.
 */

export type Sport = 'nhl' | 'nba' | 'nfl';

/** Branded IDs stop you from passing a TeamId where a PlayerId is expected. */
export type Brand<T, B extends string> = T & { readonly __brand: B };
export type LeagueId = Brand<string, 'LeagueId'>;
export type TeamId = Brand<string, 'TeamId'>;
export type PlayerId = Brand<string, 'PlayerId'>;
export type GameId = Brand<string, 'GameId'>;

export interface Contract {
  /** Cap hit in whole dollars. Integers only: never store money as floats. */
  capHit: number;
  /** Season the contract ends, e.g. 2029 means it expires after 2028–29. */
  expiresAfterSeason: number;
}

export interface Player {
  id: PlayerId;
  firstName: string;
  lastName: string;
  birthYear: number;
  teamId: TeamId | null;
  /** Sport-specific position code (hockey: 'C' | 'LW' | 'RW' | 'D' | 'G'). */
  position: string;
  /** Hidden ceiling the player can develop towards. Not shown directly in the UI. */
  potential: number;
  /**
   * Hidden ratings, 1–99, flat and numeric so ML models can consume them directly.
   * Which keys exist is defined by the sport (hockey: ./sports/hockey.ts).
   */
  ratings: Record<string, number>;
  contract?: Contract;
  /** Injured: first day (of the current season) he can play again. Absent = healthy. Heals over the summer. */
  injuredUntil?: number;
}

export interface Team {
  id: TeamId;
  city: string;
  name: string;
  abbreviation: string;
  /** Optional league structure. The schedule plays division rivals most, then the conference. */
  conference?: string;
  division?: string;
  /** Owned by the human player(s). The game supports running several teams. */
  userControlled: boolean;
}

/** Generic standings row. `otl` stays 0 in sports without overtime-loss points. */
export interface StandingsRow {
  teamId: TeamId;
  gp: number;
  w: number;
  l: number;
  otl: number;
  pts: number;
  /** Points / goals for and against (whatever the sport scores). */
  gf: number;
  ga: number;
}

/** Result of any game in any sport. Sport-specific numbers go in `stats`. */
export interface GameResult {
  id: GameId;
  /** Present only for a playoff game; keeps regular-season standings separate. */
  playoffSeriesId?: string;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
  homeScore: number;
  awayScore: number;
  /** Decided after regulation (overtime, shootout, extra innings...). */
  overtime: boolean;
  /** Sport-specific box-score numbers, typed by the sport module (hockey: HockeyGameStats). */
  stats: Record<string, number>;
  /** Sport-specific box score with player lines (hockey: HockeyBoxScore). */
  box?: unknown;
  /**
   * Players hurt in this game and how many days they miss. Not stored with the game: the engine
   * turns it into `player.injured` events and strips it.
   */
  injuries?: { playerId: PlayerId; days: number }[];
}

export interface PlayoffSeries {
  id: string;
  round: number;
  higherSeed: number;
  lowerSeed: number;
  higherTeamId: TeamId;
  lowerTeamId: TeamId;
  higherWins: number;
  lowerWins: number;
  winnerTeamId?: TeamId;
}

/** One award a season (sport-defined keys like 'mvp', plus 'champion'), as the History screen lists it. */
export interface AwardEntry {
  season: number;
  award: string;
  teamId: TeamId;
  /** Absent for team awards (champion). */
  playerId?: PlayerId;
  playerName?: string;
}

/** A stat table: the top players for one stat ('points', 'goals', 'savePct' in hockey). */
export interface Leaderboard {
  key: string;
  rows: { playerId: PlayerId; name: string; teamId: TeamId | null; gp: number; value: number }[];
}

/** One league record: best (or most) of something, by a team or player in one season, or all-time for titles. */
export interface RecordEntry {
  key:
    | 'points'
    | 'wins'
    | 'goalsFor'
    | 'goalsAgainst'
    | 'titles'
    | 'playerGoals'
    | 'playerAssists'
    | 'playerPoints'
    | 'playerSavePct';
  /** Team records only. */
  teamId?: TeamId;
  /** Player records only (retired players have no team any more). */
  playerName?: string;
  /** Absent for all-time records (titles). */
  season?: number;
  value: number;
}

/** One scheduled regular-season game. */
export interface ScheduledGame {
  id: string;
  date: { season: number; day: number };
  homeTeamId: TeamId;
  awayTeamId: TeamId;
}
