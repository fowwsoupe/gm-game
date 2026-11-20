/**
 * Hockey-specific types. Everything sport-specific lives in a file like this one;
 * NBA and NFL will get their own (sports/basketball.ts, sports/football.ts).
 */
export const HOCKEY_POSITIONS = ['C', 'LW', 'RW', 'D', 'G'] as const;
export type HockeyPosition = (typeof HOCKEY_POSITIONS)[number];

/** Special-teams units a GM can set: power-play 1 and 2, penalty-kill 1 and 2. */
export const SPECIAL_UNITS = ['pp1', 'pp2', 'pk1', 'pk2'] as const;
export type SpecialUnit = (typeof SPECIAL_UNITS)[number];
/**
 * How a team shares starts between its goalies. `backToBack`: the backup starts the second night
 * of a back-to-back (the default every AI team uses). `always`: the starter plays every game,
 * tired on the second night of a back-to-back. `split`: the backup also starts every fourth day.
 */
export const GOALIE_ROTATIONS = ['backToBack', 'always', 'split'] as const;
export type GoalieRotation = (typeof GOALIE_ROTATIONS)[number];
/**
 * Orders a coach gives from the bench (`BenchOrder.order`), none with a `value`. From the first
 * `emptyNet` or `goalieBack` the net is the coach's for the rest of the game, in place of the
 * pull rule: empty while his team trails in regulation, or the goalie stays in. `goalieChange`:
 * the other goalie comes in, once (nothing happens if he already has, or none is dressed).
 */
export const BENCH_ORDERS = ['emptyNet', 'goalieBack', 'goalieChange'] as const;
/** A starter on the second night of a back-to-back plays at this share of his rating. */
export const TIRED_GOALIE = 0.92;

/**
 * Skaters in a saved unit. A power play is any five skaters with 3 to 5 forwards (4F+1D is the
 * common mix, 3F+2D and 5F are used too). A penalty kill is 2 forwards and 2 defencemen.
 */
export const SPECIAL_UNIT_SIZE = { pp: { total: 5, minForwards: 3 }, pk: { f: 2, d: 2 } } as const;

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

/** One side of a box score. `relief` is the goalie who came in (pulled or hurt), if any. */
export interface HockeyBoxSide {
  skaters: HockeySkaterLine[];
  goalie: HockeyGoalieLine;
  relief?: HockeyGoalieLine;
}

/**
 * What the box does not keep and a viewer draws (`HockeyBoxScore.timeline`). Skaters by index,
 * as in `shots`; seconds are whole, rounded like a shot's, and each list is in the order it
 * happened. So a row and a shot in the same second can be either way round: a goal and the
 * change that follows it share a second.
 */
export interface HockeyTimeline {
  /** Each side's first defenceman in `skaters` (forwards come first). */
  firstD: [number, number];
  /**
   * [second, side, skaters on the ice], each time a side's unit changes. A skater can be listed
   * twice: the engine sends one spare for two hurt teammates of a unit and counts him twice.
   */
  shifts: [number, 0 | 1, number[]][];
  /** [second, side, what]: 0 = goalie pulled, 1 = goalie back, 2 = the other goalie in. */
  goalies: [number, 0 | 1, 0 | 1 | 2][];
  /** [second, side, skater]: he leaves the game hurt. */
  hurt: [number, 0 | 1, number][];
  /** Shootout attempts in order: [side, skater, 1 = goal]. */
  shootout: [0 | 1, number, 0 | 1][];
}

/**
 * What GameResult.box holds for hockey. Goals are the shots flagged as goals; shootout goals are
 * not listed. `emptyNet` counts the goals each side [home, away] scored into an empty net: they
 * are in `shots` but on no goalie's line. `timeline` is there only for a game played to be
 * watched (`timeline` on the game the sport plays); league games never have it and none is saved.
 */
export interface HockeyBoxScore {
  home: HockeyBoxSide;
  away: HockeyBoxSide;
  shots: HockeyShot[];
  penalties: HockeyPenalty[];
  emptyNet?: [number, number];
  timeline?: HockeyTimeline;
}

export const isGoalie = (position: string) => position === 'G';
