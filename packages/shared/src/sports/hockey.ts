/**
 * Hockey-specific types. Everything sport-specific lives in a file like this one;
 * NBA and NFL will get their own (sports/basketball.ts, sports/football.ts).
 */
export const HOCKEY_POSITIONS = ['C', 'LW', 'RW', 'D', 'G'] as const;
export type HockeyPosition = (typeof HOCKEY_POSITIONS)[number];

/**
 * The hidden rating keys: the single source of truth. The roster schema, generation and
 * export are all built from these lists. What each key means and the evidence behind the
 * list: docs/RATINGS.md. Adding or removing a key means bumping ROSTER_FORMAT_VERSION,
 * upgrading older roster files in roster-schema.ts and adding a save migration.
 */
export const SKATER_RATINGS = [
  'skating',
  'shooting',
  'passing',
  'puckHandling',
  'defense',
  'physical',
  'hockeyIq',
  'faceoffs',
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

/** One skater's night. Times are minutes on ice; `toi` is the total, power play and penalty kill included. */
export interface HockeySkaterLine {
  id: string;
  toi: number;
  ppToi: number;
  pkToi: number;
  shots: number;
  goals: number;
  /** Goals scored on the power play (also counted in `goals`). */
  ppGoals: number;
  assists: number;
  plusMinus: number;
  /** Penalty minutes. */
  pim: number;
}

export interface HockeyGoalieLine {
  id: string;
  toi: number;
  shotsAgainst: number;
  saves: number;
}

/** One penalty: [seconds into the game, side 0 = home / 1 = away, skater index, minutes]. */
export type HockeyPenalty = [number, 0 | 1, number, number];

/**
 * One shot on goal as a compact row (box scores are stored for every game):
 * [seconds into the game, side 0 = home / 1 = away, x, y, shooter, goal 0/1, assist 1, assist 2, power play 0/1].
 * x = feet from the goal line toward the faceoff dots, y = feet from the middle of the ice (the
 * net is at 0, 0). Shooter and assists are indexes into that side's `skaters`; -1 = none.
 */
export type HockeyShot = [number, 0 | 1, number, number, number, 0 | 1, number, number, 0 | 1];

/** What GameResult.box holds for hockey. Goals are the shots flagged as goals; shootout goals are not listed. */
export interface HockeyBoxScore {
  home: { skaters: HockeySkaterLine[]; goalie: HockeyGoalieLine };
  away: { skaters: HockeySkaterLine[]; goalie: HockeyGoalieLine };
  shots: HockeyShot[];
  penalties: HockeyPenalty[];
}

export const isGoalie = (position: string) => position === 'G';
