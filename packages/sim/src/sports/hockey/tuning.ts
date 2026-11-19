import type { TeamStrength } from './strength';

/** Knobs to tune the game sim. Kept in one place so balance changes are easy to find. */
export const HOCKEY_TUNING = {
  /** Shots on goal per team per 60 minutes between two average units at even strength. */
  shotsPer60: 26.0,
  /** How strongly a rating gap between the attacking and defending unit moves the shot rate. */
  ratingSensitivity: 0.0085,
  /**
   * The average starting goalie's rating, and how strongly a gap moves his goal chance per shot.
   * Set so a starter's save % repeats year to year at r 0.12-0.30 as in the NHL (balance lab);
   * at 0.011 it repeated at 0.6, so goalies were far more predictable than real ones.
   */
  leagueAvgGoaltending: 67,
  goalieSensitivity: 0.005,
  /**
   * Goalie form: each game, a goalie's goal chance against is multiplied by exp(N(0, sd)), with
   * sd = goalieFormSd x (1.5 - consistency / 100). Calibrated so a team game's goals vary around
   * expected goals as much as in the NHL (balance lab "Goals vs expected" check; ml/src/form.py).
   * 0.16 since new leagues start with smaller team edges (less goalie spread left 0.14 at the floor).
   */
  goalieFormSd: 0.16,
  homeIceBoost: 1.07,
  /** Shot rate changes by this (log) per skater of man advantage: 5v4 is about 1.7 times even strength. */
  manAdvantageStep: 0.55,
  /** Shot rate in 3v3 overtime relative to five-on-five. */
  overtimePace: 2.4,
  /** Minor penalties a team takes per game, and how long each lasts (seconds). */
  penaltiesPerTeam: 3,
  penaltySeconds: 120,
  /** A team on the power play shoots from chances this much better. */
  powerPlayQuality: 1.5,
  /** A shot's goal chance scales by (shooting / reference) ^ exponent: a 65 shooter is the baseline. */
  shootingReference: 65,
  shootingExponent: 0.7,
  /** Scales every shot's goal chance (the GoalModel's output) so the league saves about 90%. */
  xgScale: 1.02,
  /** A trailing team pulls its goalie this many seconds before the end: down one, down two. */
  pullSeconds: [150, 90],
  /** Chance a shot at an empty net goes in. */
  emptyNetGoal: 0.7,
  /** Shift length (seconds) between line changes. */
  shiftSeconds: 45,
  /** A goalie who has let in four before the late second period is pulled this often. */
  pulledAfterFour: 0.6,
  overtimeSeconds: 300,
  shootoutGoal: 0.33,
} as const;

/** What a goal model sees of a shot. */
export interface ShotInfo {
  /** Feet from the goal line toward the dots, and from the middle of the ice (net at 0, 0). */
  x: number;
  y: number;
  /** The shooter's shooting rating. */
  shooting: number;
  /** The shooting team has a man advantage from a penalty. */
  power: boolean;
}

/**
 * Anything that can say how likely a shot is to be a goal against an average goalie (expected
 * goals). The default is rules-based; an ML shot-quality model (trained in /ml, shipped as
 * a `gm-xg-table`, see xgTable.ts) can implement the same interface. The engine adds the goalie's effect on top.
 */
export interface GoalModel {
  shotXg(shot: ShotInfo): number;
}

/** Scoring chance of a shot from where it is taken: close and in front is dangerous. */
const shotQuality = (x: number, y: number) =>
  0.3 * Math.exp(-Math.hypot(x, y) / 22) * Math.max(0.2, x / Math.hypot(x, y));

export const rulesGoalModel: GoalModel = {
  shotXg: ({ x, y, shooting, power }) =>
    HOCKEY_TUNING.xgScale *
    shotQuality(x, y) *
    (shooting / HOCKEY_TUNING.shootingReference) ** HOCKEY_TUNING.shootingExponent *
    (power ? HOCKEY_TUNING.powerPlayQuality : 1),
};

/**
 * How much better team `a` is than team `b` at five-on-five, as the log of its goal ratio:
 * positive = `a` is better. For the balance lab and for odds; not used by the game itself.
 */
export const strengthEdge = (a: TeamStrength, b: TeamStrength): number =>
  HOCKEY_TUNING.ratingSensitivity * (a.offense - b.defense - (b.offense - a.defense)) +
  HOCKEY_TUNING.goalieSensitivity * (a.goaltending - b.goaltending);
