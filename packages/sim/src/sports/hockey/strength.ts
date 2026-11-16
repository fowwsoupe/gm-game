import { isGoalie, type Player } from '@gm/shared';
import { overall } from '../../players';

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 50);

export interface TeamStrength {
  offense: number;
  defense: number;
  /** The starting goalie's rating, and the backup's (who plays the second night of a back-to-back). */
  goaltending: number;
  backupGoaltending: number;
  /** The depth chart these numbers come from (also who is credited in the box score). */
  lineup: Lineup;
}

/** A depth chart: forward lines (C, LW, RW), defence pairs, goalies. Best first. */
export interface Lineup {
  forwards: Player[][];
  defense: Player[][];
  goalies: Player[];
}

/**
 * Share of the game each line or pair plays (a game is 60 minutes of five-on-five and the
 * second line plays about 30 of them). Each row sums to 1.
 */
export const ICE_TIME = {
  forwardLines: [0.38, 0.31, 0.2, 0.11],
  defensePairs: [0.42, 0.35, 0.23],
} as const;

/** How much forwards and defencemen count toward a team's attack and defence. */
const UNIT_WEIGHT = {
  offense: { forwards: 0.75, defense: 0.25 },
  defense: { forwards: 0.4, defense: 0.6 },
};

const byRating = (a: Player, b: Player) => overall(b) - overall(a) || a.id.localeCompare(b.id);

/**
 * The lineup a coach would pick: the best centre, left wing and right wing together on line 1,
 * the next best on line 2, and so on; defence in pairs by rating; goalies by rating.
 * TODO(feature): user-set lines, injuries, chemistry, line matching.
 */
export function autoLineup(players: readonly Player[]): Lineup {
  const at = (position: string) => players.filter((p) => p.position === position).sort(byRating);
  const [c, lw, rw, d] = [at('C'), at('LW'), at('RW'), at('D')];
  const lines = ICE_TIME.forwardLines.map((_, i) =>
    [c[i], lw[i], rw[i]].filter((p) => p !== undefined),
  );
  const pairs = ICE_TIME.defensePairs.map((_, i) =>
    [d[2 * i], d[2 * i + 1]].filter((p) => p !== undefined),
  );
  return {
    forwards: lines,
    defense: pairs,
    goalies: players
      .filter((p) => isGoalie(p.position))
      .sort((a, b) => goalieScore(b) - goalieScore(a)),
  };
}

const r = (p: Player, k: string) => p.ratings[k] ?? 50;
const attack = (p: Player) =>
  r(p, 'shooting') * 0.4 +
  r(p, 'passing') * 0.3 +
  r(p, 'puckHandling') * 0.2 +
  r(p, 'skating') * 0.1;
const defence = (p: Player) =>
  r(p, 'defense') * 0.5 + r(p, 'hockeyIq') * 0.3 + r(p, 'physical') * 0.2;
const goalieScore = (p: Player) =>
  r(p, 'reflexes') * 0.4 +
  r(p, 'positioning') * 0.35 +
  r(p, 'reboundControl') * 0.15 +
  r(p, 'consistency') * 0.1;

/** Ice-time-weighted average of a skill over lines; a missing line counts as an average (50) one. */
function weighted(
  units: Player[][],
  weights: readonly number[],
  skill: (p: Player) => number,
): number {
  return units.reduce(
    (sum, unit, i) => sum + weights[i]! * (unit.length ? avg(unit.map(skill)) : 50),
    0,
  );
}

/**
 * Rules-based team strength from the lineup: stars on the top lines count more because they
 * play more. One of the places an ML model (trained in /ml) can replace hand-tuned weights.
 */
export function teamStrength(players: readonly Player[]): TeamStrength {
  const lineup = autoLineup(players);
  const { forwards, defense, goalies } = lineup;
  const f = ICE_TIME.forwardLines;
  const d = ICE_TIME.defensePairs;
  const mix = (w: { forwards: number; defense: number }, skill: (p: Player) => number) =>
    w.forwards * weighted(forwards, f, skill) + w.defense * weighted(defense, d, skill);
  return {
    offense: mix(UNIT_WEIGHT.offense, attack),
    defense: mix(UNIT_WEIGHT.defense, defence),
    goaltending: goalies[0] ? goalieScore(goalies[0]) : 40,
    backupGoaltending: goalies[1] ? goalieScore(goalies[1]) : 40,
    lineup,
  };
}
