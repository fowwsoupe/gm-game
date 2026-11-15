import type {
  HockeyBoxScore,
  HockeyGoalieLine,
  HockeyShot,
  HockeySkaterLine,
  Player,
} from '@gm/shared';
import type { Rng } from '../../core';
import { ICE_TIME, type TeamStrength } from './strength';

/** Who shoots: defencemen take far fewer shots than forwards. */
const D_SHOOTING = 0.35;
/** Chance a goal has a first and a second assist. */
const ASSIST = [0.93, 0.62] as const;
/** Overtime lasts up to five minutes (seconds after regulation). */
const OVERTIME_SECONDS = [10, 300] as const;

const rating = (p: Player, key: string) => p.ratings[key] ?? 50;

/** Index of one weight picked in proportion to its size. */
function pick(weights: readonly number[], rng: Rng): number {
  let roll = rng.next() * weights.reduce((a, b) => a + b, 0);
  const i = weights.findIndex((w) => (roll -= w) < 0);
  return i < 0 ? weights.length - 1 : i;
}

/** Scoring chance of a shot from where it is taken: close and in front is dangerous. */
export const shotQuality = (x: number, y: number) =>
  0.3 * Math.exp(-Math.hypot(x, y) / 22) * Math.max(0.2, x / Math.hypot(x, y));

interface Side {
  skaters: HockeySkaterLine[];
  players: Player[];
  /** Skater indexes of each forward line and defence pair. */
  lines: number[][];
  pairs: number[][];
  goalie: Player | undefined;
}

function side(strength: TeamStrength, backup: boolean): Side {
  const { forwards, defense, goalies } = strength.lineup;
  const players: Player[] = [];
  const index = (unit: Player[]) => unit.map((p) => players.push(p) - 1);
  const lines = forwards.map(index);
  const pairs = defense.map(index);
  const lineOf = (i: number) => (i < lines.length ? ICE_TIME.forwardLines[i]! : 0);
  const shareOf = new Map<number, number>();
  lines.forEach((u, i) => u.forEach((k) => shareOf.set(k, lineOf(i))));
  pairs.forEach((u, i) => u.forEach((k) => shareOf.set(k, ICE_TIME.defensePairs[i]!)));
  return {
    players,
    lines,
    pairs,
    goalie: backup ? (goalies[1] ?? goalies[0]) : goalies[0],
    skaters: players.map((p, k) => ({
      id: p.id,
      toi: Math.round(shareOf.get(k)! * 600) / 10,
      shots: 0,
      goals: 0,
      assists: 0,
      plusMinus: 0,
    })),
  };
}

/** The skaters on the ice: a random forward line and defence pair, by ice time (empty lines never play). */
function onIce(s: Side, rng: Rng): number[] {
  const unit = (units: number[][], shares: readonly number[]) => {
    const weights = units.map((u, i) => (u.length ? shares[i]! : 0));
    return weights.some((w) => w > 0) ? units[pick(weights, rng)]! : [];
  };
  return [...unit(s.lines, ICE_TIME.forwardLines), ...unit(s.pairs, ICE_TIME.defensePairs)];
}

/**
 * Turns a game's team result into a box score: who shot, where from, who scored and assisted,
 * ice time, plus-minus and the goalies' saves. The totals are decided first (goals and shots per
 * team); this only says how they happened, so team balance is not touched.
 * TODO(M2): penalties and power-play time, injuries, empty-net goals, a real xG model (ONNX).
 */
export function makeBoxScore(
  game: {
    home: TeamStrength;
    away: TeamStrength;
    homeBackup: boolean;
    awayBackup: boolean;
    /** Goals to credit to players per team (a shootout goal is not one). */
    goals: { home: number; away: number };
    shots: { home: number; away: number };
    /** The team that scored in overtime, if the game was settled there. */
    overtimeGoal: 'home' | 'away' | null;
  },
  rng: Rng,
): HockeyBoxScore {
  const sides = [side(game.home, game.homeBackup), side(game.away, game.awayBackup)] as const;
  const shots: HockeyShot[] = [];

  for (const [n, attack] of sides.entries()) {
    if (attack.players.length === 0) continue; // nobody to credit
    const defend = sides[1 - n]!;
    const key = n === 0 ? 'home' : 'away';
    const overtime = game.overtimeGoal === key ? 1 : 0;
    const goals = game.goals[key] - overtime;
    const regular = Math.max(goals, game.shots[key] - overtime);

    const makeShot = (time: number): HockeyShot & { quality: number; unit: number[] } => {
      const unit = onIce(attack, rng);
      const weights = unit.map((k) => {
        const p = attack.players[k]!;
        const isDefense = attack.pairs.some((pair) => pair.includes(k));
        return (rating(p, 'shooting') / 50) ** 2 * (isDefense ? D_SHOOTING : 1);
      });
      const shooter = unit[pick(weights, rng)]!;
      const distance = 8 + Math.min(52, Math.abs(rng.normal(0, 22)));
      const angle = rng.normal(0, 0.45 + distance / 100);
      // `+ 0` turns -0 into 0, which JSON would otherwise change on a save round trip.
      const x = Math.round(distance * Math.cos(angle)) + 0;
      const y = Math.round(distance * Math.sin(angle)) + 0;
      const quality = shotQuality(x, y) * (rating(attack.players[shooter]!, 'shooting') / 65);
      return Object.assign([time, n as 0 | 1, x, y, shooter, 0, -1, -1] as HockeyShot, {
        quality,
        unit,
      });
    };

    const taken = Array.from({ length: regular }, () => makeShot(rng.int(0, 3599)));
    // The goals come from the best chances: pick shots by quality, without repeats.
    const open = taken.map((_, i) => i);
    const scoring = new Set<number>();
    for (let g = 0; g < goals; g++) {
      const at = pick(
        open.map((i) => taken[i]!.quality),
        rng,
      );
      scoring.add(open.splice(at, 1)[0]!);
    }
    if (overtime) {
      taken.push(makeShot(3600 + rng.int(...OVERTIME_SECONDS)));
      scoring.add(taken.length - 1);
    }

    taken.forEach((shot, i) => {
      attack.skaters[shot[4]]!.shots++;
      if (!scoring.has(i)) return;
      shot[5] = 1;
      attack.skaters[shot[4]]!.goals++;
      const others = shot.unit.filter((k) => k !== shot[4]);
      for (const slot of [6, 7] as const) {
        if (!rng.chance(ASSIST[slot - 6]!)) break;
        const k = others.splice(
          pick(
            others.map((o) => 0.5 + rating(attack.players[o]!, 'passing') / 50),
            rng,
          ),
          1,
        )[0]!;
        shot[slot] = k;
        attack.skaters[k]!.assists++;
      }
      for (const k of shot.unit) attack.skaters[k]!.plusMinus++;
      for (const k of onIce(defend, rng)) defend.skaters[k]!.plusMinus--;
    });
    shots.push(...taken.map((s) => [...s.slice(0, 8)] as HockeyShot));
  }

  const goalie = (own: Side, against: 'home' | 'away'): HockeyGoalieLine => {
    const faced = game.shots[against];
    return {
      id: own.goalie?.id ?? '',
      toi: 60,
      shotsAgainst: faced,
      saves: faced - game.goals[against],
    };
  };
  return {
    home: { skaters: sides[0].skaters, goalie: goalie(sides[0], 'away') },
    away: { skaters: sides[1].skaters, goalie: goalie(sides[1], 'home') },
    shots: shots.sort((a, b) => a[0] - b[0]),
  };
}
