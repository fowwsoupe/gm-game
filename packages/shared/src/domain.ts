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
}

export interface Team {
  id: TeamId;
  city: string;
  name: string;
  abbreviation: string;
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
