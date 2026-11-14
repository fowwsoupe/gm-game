/**
 * Hockey-specific types. Everything sport-specific lives in a file like this one;
 * NBA and NFL will get their own (sports/basketball.ts, sports/football.ts).
 */
export const HOCKEY_POSITIONS = ['C', 'LW', 'RW', 'D', 'G'] as const;
export type HockeyPosition = (typeof HOCKEY_POSITIONS)[number];

export const SKATER_RATINGS = [
  'skating',
  'shooting',
  'passing',
  'puckHandling',
  'defense',
  'physical',
  'hockeyIq',
] as const;
export const GOALIE_RATINGS = ['reflexes', 'positioning', 'reboundControl', 'consistency'] as const;
export type SkaterRating = (typeof SKATER_RATINGS)[number];
export type GoalieRating = (typeof GOALIE_RATINGS)[number];

/** Hockey's extra numbers stored in GameResult.stats. */
export interface HockeyGameStats extends Record<string, number> {
  homeShots: number;
  awayShots: number;
  /** 1 if decided by shootout, else 0. */
  shootout: number;
}

export const isGoalie = (position: string) => position === 'G';
