/**
 * Core domain types shared by every package.
 * Sport-agnostic where possible; sport-specific details live under a `sport` key
 * so NBA and NFL can be added later without rewriting the core.
 */

export type Sport = 'nhl' | 'nba' | 'nfl';

/** Branded IDs stop you from passing a TeamId where a PlayerId is expected. */
export type Brand<T, B extends string> = T & { readonly __brand: B };
export type LeagueId = Brand<string, 'LeagueId'>;
export type TeamId = Brand<string, 'TeamId'>;
export type PlayerId = Brand<string, 'PlayerId'>;
export type GameId = Brand<string, 'GameId'>;

export type HockeyPosition = 'C' | 'LW' | 'RW' | 'D' | 'G';

/** Ratings are 1–99. Kept flat and numeric so ML models can consume them directly. */
export interface HockeySkaterRatings {
  skating: number;
  shooting: number;
  passing: number;
  puckHandling: number;
  defense: number;
  physical: number;
  hockeyIq: number;
}

export interface HockeyGoalieRatings {
  reflexes: number;
  positioning: number;
  reboundControl: number;
  consistency: number;
}

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
  position: HockeyPosition;
  /** Hidden ceiling the player can develop towards. Not shown directly in the UI. */
  potential: number;
  skater?: HockeySkaterRatings;
  goalie?: HockeyGoalieRatings;
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

export interface StandingsRow {
  teamId: TeamId;
  gp: number;
  w: number;
  l: number;
  otl: number;
  pts: number;
  gf: number;
  ga: number;
}

export interface GameResult {
  id: GameId;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
  homeGoals: number;
  awayGoals: number;
  overtime: boolean;
  shootout: boolean;
  homeShots: number;
  awayShots: number;
}
