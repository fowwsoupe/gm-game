import { isGoalie, SPECIAL_UNIT_SIZE, type Player, type SpecialUnit } from '@gm/shared';
import { linemateKey } from '../../core';
import { overall } from '../../players';

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 50);

export interface TeamStrength {
  offense: number;
  defense: number;
  /** The starting goalie's rating. */
  goaltending: number;
  /** Chemistry's bonus to every unit's attack and defence, in rating points (±CHEMISTRY_POINTS). */
  chemistry: number;
  /**
   * Each forward line's and defence pair's own bonus in rating points (builds fit, linemates), by unit,
   * added in the game to the units on the ice. `offense` and `defense` above include their
   * ice-time-weighted sum.
   */
  unitBonus: { forwards: UnitBonus[]; defense: UnitBonus[] };
  /** The depth chart these numbers come from (also who is credited in the box score). */
  lineup: Lineup;
}

/** A depth chart: forward lines (C, LW, RW), defence pairs, goalies. Best first. */
export interface Lineup {
  forwards: Player[][];
  defense: Player[][];
  goalies: Player[];
  /** Saved power-play and penalty-kill units that can be dressed tonight; others are auto. */
  special?: Partial<Record<SpecialUnit, Player[]>>;
}

export interface UnitBonus {
  offense: number;
  defense: number;
}

/** Saved units by player id (see `SpecialUnit`). */
export type SavedUnits = Partial<Record<SpecialUnit, readonly string[]>>;

const isD = (p: Player) => p.position === 'D';

/** A unit has a legal mix: five skaters with 3-5 forwards for a power play, 2F+2D for a kill. */
export function unitOk(unit: SpecialUnit, players: readonly Player[]): boolean {
  const nd = players.filter(isD).length;
  const mix = unit.startsWith('pp')
    ? players.length === SPECIAL_UNIT_SIZE.pp.total &&
      players.length - nd >= SPECIAL_UNIT_SIZE.pp.minForwards
    : players.length === SPECIAL_UNIT_SIZE.pk.f + SPECIAL_UNIT_SIZE.pk.d &&
      nd === SPECIAL_UNIT_SIZE.pk.d;
  return (
    mix &&
    players.every((p) => p.position !== 'G') &&
    new Set(players.map((p) => p.id)).size === players.length
  );
}

/** Saved units whose players are all dressed (healthy, on a line or pair) with the right mix. */
function dressedUnits(lineup: Lineup, saved: SavedUnits): NonNullable<Lineup['special']> {
  const byId = new Map<string, Player>(
    [...lineup.forwards.flat(), ...lineup.defense.flat()].map((p) => [p.id, p]),
  );
  const out: NonNullable<Lineup['special']> = {};
  for (const [unit, ids] of Object.entries(saved) as [SpecialUnit, readonly string[]][]) {
    const ps = ids.map((id) => byId.get(id));
    if (ps.length && ps.every((p) => p) && unitOk(unit, ps as Player[])) out[unit] = ps as Player[];
  }
  return out;
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
export const UNIT_WEIGHT = {
  offense: { forwards: 0.75, defense: 0.25 },
  defense: { forwards: 0.4, defense: 0.6 },
};

/**
 * Faceoffs: each point of the centres' draw skill (by ice time) above 50 adds this much to both
 * attack and defence. Calibrated (ml/src/faceoffs.py, NHL 2022-25): one SD of team faceoff % is
 * worth about +0.07 goals/game after prior-season goal diff (95% CI -0.04 to 0.17). At 0.2 the sim
 * gives about +0.05 per SD of draw skill (balance lab "Faceoff effect" check).
 */
export const FACEOFF_WEIGHT = 0.2;

/**
 * Chemistry (0–1, from the people engine) moves attack and defence by up to this many rating
 * points either way around a settled-average team (0.5). Capped by design: worth a few percent
 * of goal difference at most.
 */
export const CHEMISTRY_POINTS = 1;

/**
 * Builds fit: a forward line wants a finisher (shooting over passing) and a creator (passing over
 * shooting) as different players; a defence pair wants one who joins the attack and one who stays
 * home. A unit's fit is 0-1: how far its most extreme player on each side is from even, up to a
 * span of rating points. Three of a kind, or three generalists, fit at 0.
 */
export const FIT_SPAN = { forwards: 15, defense: 8 } as const;
/** Rating points a team with a perfectly fitting set of units adds (units weighted by ice time). */
export const FIT_POINTS = 3;
/**
 * The league's typical team fit (ice-time-weighted, measured on generated leagues), subtracted so
 * an average team nets zero and the bonus only separates teams.
 */
export const FIT_BASELINE = { forwards: 0.21, defense: 0.12 } as const;

/**
 * Linemates: games a pair has played in the same unit before a unit counts as fully together.
 * A unit's value is the mean over its pairs; it moves the unit's attack and defence by up to
 * `LINEMATES_POINTS` either way around a half-together unit (a line and a pair on the ice
 * together: twice that). Kept small, like chemistry.
 */
export const LINEMATES_FULL_GAMES = 20;
export const LINEMATES_POINTS = 0.5;

/** 0-1: how much a unit's players have played together (1 = every pair `LINEMATES_FULL_GAMES` games). */
export function unitTogether(
  unit: readonly Player[],
  linemates: Readonly<Record<string, number>>,
): number {
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < unit.length; i++) {
    for (let j = i + 1; j < unit.length; j++) {
      sum += Math.min(
        1,
        (linemates[linemateKey(unit[i]!.id, unit[j]!.id)] ?? 0) / LINEMATES_FULL_GAMES,
      );
      pairs++;
    }
  }
  return pairs ? sum / pairs : 0;
}

/** A team's time together, ice-time-weighted, for its forward lines and its defence pairs. */
export function lineupTogether(
  lineup: Lineup,
  linemates: Readonly<Record<string, number>> = {},
): { forwards: number; defense: number } {
  const sum = (units: Player[][], w: readonly number[]) =>
    units.reduce((t, u, i) => t + w[i]! * unitTogether(u, linemates), 0);
  return {
    forwards: sum(lineup.forwards, ICE_TIME.forwardLines),
    defense: sum(lineup.defense, ICE_TIME.defensePairs),
  };
}

const finisher = (p: Player) => r(p, 'shooting') - r(p, 'passing');
const rusher = (p: Player) => attack(p) - defence(p);

/** 0-1: how well a unit's players complement each other, by how `lean` splits them. */
export function unitFit(
  unit: readonly Player[],
  lean: (p: Player) => number,
  span: number,
): number {
  if (unit.length < 2) return 0;
  const leans = unit.map(lean);
  return Math.max(0, Math.min(1, Math.min(Math.max(...leans), -Math.min(...leans)) / span));
}

/** A team's fit, ice-time-weighted, for its forward lines and its defence pairs. */
export function lineupFit(lineup: Lineup): { forwards: number; defense: number } {
  const sum = (
    units: Player[][],
    w: readonly number[],
    lean: (p: Player) => number,
    span: number,
  ) => units.reduce((t, u, i) => t + w[i]! * unitFit(u, lean, span), 0);
  return {
    forwards: sum(lineup.forwards, ICE_TIME.forwardLines, finisher, FIT_SPAN.forwards),
    defense: sum(lineup.defense, ICE_TIME.defensePairs, rusher, FIT_SPAN.defense),
  };
}

const byRating = (a: Player, b: Player) => overall(b) - overall(a) || a.id.localeCompare(b.id);

/**
 * The lineup a coach would pick: the best centre, left wing and right wing together on line 1,
 * the next best on line 2, and so on; defence in pairs; goalies in order. `depth` (the GM's
 * order, best first) ranks players ahead of their ratings; anyone not in it follows by rating.
 * Injured players are left out by the caller (the engine passes only healthy players).
 * TODO(feature): chemistry, line matching, playing a player out of position.
 */
export function autoLineup(players: readonly Player[], depth: readonly string[] = []): Lineup {
  const rank = new Map(depth.map((id, i) => [id, i]));
  const order = (a: Player, b: Player) =>
    (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || byRating(a, b);
  const at = (position: string) => players.filter((p) => p.position === position).sort(order);
  const [c, lw, rw, d] = [at('C'), at('LW'), at('RW'), at('D')];
  // A line short of a centre or winger (injuries) takes the best spare forward of any position.
  const spares = [c, lw, rw]
    .flatMap((list) => list.slice(ICE_TIME.forwardLines.length))
    .sort(byRating);
  const lines = ICE_TIME.forwardLines.map((_, i) =>
    [c[i] ?? spares.shift(), lw[i] ?? spares.shift(), rw[i] ?? spares.shift()].filter(
      (p) => p !== undefined,
    ),
  );
  // Short of defencemen, a leftover forward plays a defence slot (an emergency, not a good one).
  const pairs = ICE_TIME.defensePairs.map((_, i) =>
    [d[2 * i] ?? spares.shift(), d[2 * i + 1] ?? spares.shift()].filter((p) => p !== undefined),
  );
  return {
    forwards: lines,
    defense: pairs,
    goalies: players
      .filter((p) => isGoalie(p.position))
      .sort(
        (a, b) =>
          (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
          goalieScore(b) - goalieScore(a),
      ),
  };
}

export const rating = (p: Player, k: string) => p.ratings[k] ?? 50;
const r = rating;
export const attack = (p: Player) =>
  r(p, 'shooting') * 0.4 +
  r(p, 'passing') * 0.3 +
  r(p, 'puckHandling') * 0.2 +
  r(p, 'skating') * 0.1;
export const defence = (p: Player) =>
  r(p, 'defense') * 0.5 + r(p, 'hockeyIq') * 0.3 + r(p, 'physical') * 0.2;
export const faceoffs = (p: Player) => r(p, 'faceoffs');
export const goalieScore = (p: Player) =>
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
export function teamStrength(
  players: readonly Player[],
  depth: readonly string[] = [],
  chemistry = 0.5,
  saved: SavedUnits = {},
  linemates: Readonly<Record<string, number>> = {},
): TeamStrength {
  const chem = CHEMISTRY_POINTS * 2 * (Math.max(0, Math.min(1, chemistry)) - 0.5);
  const lineup = autoLineup(players, depth);
  lineup.special = dressedUnits(lineup, saved);
  const { forwards, defense, goalies } = lineup;
  const f = ICE_TIME.forwardLines;
  const d = ICE_TIME.defensePairs;
  // Builds fit: a line's fit moves its attack, a pair's its defence. Linemates move both.
  const together = (u: Player[]) => LINEMATES_POINTS * (2 * unitTogether(u, linemates) - 1);
  const unitBonus = {
    forwards: forwards.map((u) => ({
      offense:
        FIT_POINTS * (unitFit(u, finisher, FIT_SPAN.forwards) - FIT_BASELINE.forwards) +
        together(u),
      defense: together(u),
    })),
    defense: defense.map((u) => ({
      offense: together(u),
      defense:
        FIT_POINTS * (unitFit(u, rusher, FIT_SPAN.defense) - FIT_BASELINE.defense) + together(u),
    })),
  };
  const byIce = (k: keyof UnitBonus) =>
    unitBonus.forwards.reduce((s, b, i) => s + f[i]! * b[k], 0) +
    unitBonus.defense.reduce((s, b, i) => s + d[i]! * b[k], 0);
  const mix = (w: { forwards: number; defense: number }, skill: (p: Player) => number) =>
    w.forwards * weighted(forwards, f, skill) + w.defense * weighted(defense, d, skill);
  // The first player on each line takes its draws (its centre, or whoever fills that slot).
  const draws =
    FACEOFF_WEIGHT *
    (weighted(
      forwards.map((l) => l.slice(0, 1)),
      f,
      faceoffs,
    ) -
      50);
  return {
    offense: mix(UNIT_WEIGHT.offense, attack) + draws + chem + byIce('offense'),
    defense: mix(UNIT_WEIGHT.defense, defence) + draws + chem + byIce('defense'),
    goaltending: goalies[0] ? goalieScore(goalies[0]) : 40,
    chemistry: chem,
    unitBonus,
    lineup,
  };
}

/** The lineup as named units for the lines screen: F1–F4, D1–D3, then goalies in order. */
export function lineupUnits(
  players: readonly Player[],
  depth: readonly string[] = [],
): { unit: string; playerIds: string[] }[] {
  const { forwards, defense, goalies } = autoLineup(players, depth);
  return [
    ...forwards.map((l, i) => ({ unit: `F${i + 1}`, playerIds: l.map((p) => p.id) })),
    ...defense.map((l, i) => ({ unit: `D${i + 1}`, playerIds: l.map((p) => p.id) })),
    { unit: 'G', playerIds: goalies.map((p) => p.id) },
  ];
}

/** Power-play and penalty-kill units as the game would use them, and whether the GM set them. */
export function specialUnitsView(
  players: readonly Player[],
  depth: readonly string[] = [],
  saved: SavedUnits = {},
): Record<SpecialUnit, { playerIds: string[]; custom: boolean }> {
  const lineup = autoLineup(players, depth);
  const mine = dressedUnits(lineup, saved);
  // The auto kill: the four best defensive forwards (ties by lineup order), two a unit.
  const killers = lineup.forwards
    .flat()
    .map((p, i) => [p, i] as const)
    .sort((a, b) => rating(b[0], 'defense') - rating(a[0], 'defense') || a[1] - b[1])
    .slice(0, 4)
    .map(([p]) => p);
  const auto = (unit: SpecialUnit, k: number) =>
    unit.startsWith('pp')
      ? [...(lineup.forwards[k] ?? []).slice(0, 3), ...(lineup.defense[k] ?? []).slice(0, 2)]
      : [...killers.slice(2 * k, 2 * k + 2), ...(lineup.defense[k] ?? []).slice(0, 2)];
  const view = (unit: SpecialUnit, k: number) => ({
    playerIds: (mine[unit] ?? auto(unit, k)).map((p) => p.id),
    custom: !!mine[unit],
  });
  return { pp1: view('pp1', 0), pp2: view('pp2', 1), pk1: view('pk1', 0), pk2: view('pk2', 1) };
}
