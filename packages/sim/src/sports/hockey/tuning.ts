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

/**
 * Real skater shapes, clustered from NHL seasons by `ml/src/builds.py`
 * (docs/research/2026-11-player-builds-evidence.md): each build's share of skater seasons and
 * its centre per rating key in SDs, after removing the player's own mean. A key not listed is 0.
 */
export const SKATER_BUILD_CLUSTERS = {
  forwards: [
    {
      build: 'defensiveF',
      share: 0.275,
      centre: { shooting: -0.23, passing: -0.31, physical: -0.17, hockeyIq: -0.19, defense: 0.35 },
    },
    {
      build: 'twoWay',
      share: 0.212,
      centre: { shooting: -0.19, passing: -0.06, physical: -0.23, hockeyIq: 1.16, defense: 0.24 },
    },
    {
      build: 'sniper',
      share: 0.188,
      centre: { shooting: 1.13, passing: 0.04, physical: -0.33, hockeyIq: -0.52, defense: -0.42 },
    },
    {
      build: 'playmaker',
      share: 0.164,
      centre: { shooting: 0.04, passing: 1.31, physical: -0.83, hockeyIq: -0.2, defense: -0.26 },
    },
    {
      build: 'grinder',
      share: 0.16,
      centre: { shooting: -0.72, passing: -0.79, physical: 1.83, hockeyIq: -0.38, defense: -0.16 },
    },
  ],
  defence: [
    {
      build: 'shutdownD',
      share: 0.569,
      centre: { shooting: -0.34, passing: -0.37, physical: 0.65, hockeyIq: -0.19, defense: 0.03 },
    },
    {
      build: 'offensiveD',
      share: 0.431,
      centre: { shooting: 0.45, passing: 0.49, physical: -0.86, hockeyIq: 0.25, defense: -0.04 },
    },
  ],
} as const;
/**
 * Rating points per SD of a build's centre, when a skater is generated (generate.ts). At 5 every
 * key keeps a die: grinders' physical, the largest shape, takes 17 of the key's 24 of variance.
 */
export const SHAPE_POINTS = 5;

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
