import type {
  HockeyBoxScore,
  HockeyGoalieLine,
  HockeyPenalty,
  HockeyShot,
  HockeySkaterLine,
  Player,
  PlayerId,
} from '@gm/shared';
import type { Rng } from '../../core';
import { ICE_TIME, type TeamStrength } from './strength';

/** Who shoots: defencemen take far fewer shots than forwards. */
const D_SHOOTING = 0.35;
/** Talent concentrates: a 90 shooter takes and scores far more than twice a 60 shooter's goals. */
const SKILL_POWER = 3;
/** Chance a goal has a first and a second assist. */
const ASSIST = [0.93, 0.62] as const;
/** Overtime lasts up to five minutes (seconds after regulation). */
const OVERTIME_SECONDS = [10, 300] as const;
/** Minor penalties a team takes in a game, and how long each lasts (minutes). */
const PENALTIES_PER_TEAM = 3;
const PENALTY_MINUTES = 2;
/** A team on the power play shoots this many times as often, from chances this much better. */
const PP_SHOT_RATE = 1.8;
const PP_SHOT_QUALITY = 1.5;
/**
 * Injuries: the chance a skater with an average night's ice time (16.7 minutes) is hurt in a game
 * (about eight a season per team), and how many days he misses: mostly days, sometimes months.
 */
const INJURY_PER_GAME = 0.005;
const AVG_TOI = 16.7;
/** A starting goalie's chance of being hurt in a game. */
const GOALIE_INJURY_PER_GAME = 0.002;
const INJURY_DAYS = [
  { weight: 60, days: [3, 14] },
  { weight: 30, days: [15, 60] },
  { weight: 10, days: [61, 180] },
] as const;
/** Share of power-play and penalty-kill time played by the first and second unit. */
const UNIT_SPLIT = [0.55, 0.45] as const;

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
  /** First and second power-play unit (a forward line and a pair) and penalty-kill unit (two forwards, a pair). */
  ppUnits: number[][];
  pkUnits: number[][];
  goalie: Player | undefined;
}

function side(strength: TeamStrength, backup: boolean): Side {
  const { forwards, defense, goalies } = strength.lineup;
  const players: Player[] = [];
  const index = (unit: Player[]) => unit.map((p) => players.push(p) - 1);
  const lines = forwards.map(index);
  const pairs = defense.map(index);
  // Penalty killers: the four best defensive forwards, two to a unit.
  const killers = lines
    .flat()
    .sort((a, b) => rating(players[b]!, 'defense') - rating(players[a]!, 'defense') || a - b)
    .slice(0, 4);
  const unit = (...parts: (number[] | undefined)[]) => parts.flatMap((u) => u ?? []);
  return {
    players,
    lines,
    pairs,
    ppUnits: [unit(lines[0], pairs[0]), unit(lines[1], pairs[1])],
    pkUnits: [unit(killers.slice(0, 2), pairs[0]), unit(killers.slice(2), pairs[1])],
    goalie: backup ? (goalies[1] ?? goalies[0]) : goalies[0],
    skaters: players.map((p) => ({
      id: p.id,
      toi: 0,
      ppToi: 0,
      pkToi: 0,
      shots: 0,
      goals: 0,
      ppGoals: 0,
      assists: 0,
      plusMinus: 0,
      pim: 0,
    })),
  };
}

/** Everyone's minutes: even strength shared by line, then their power-play and penalty-kill units' time. */
function setIceTime(s: Side, ppMinutes: number, pkMinutes: number) {
  const even = 60 - ppMinutes - pkMinutes;
  const add = (units: number[][], minutes: number, key: 'ppToi' | 'pkToi') =>
    units.forEach((u, i) => u.forEach((k) => (s.skaters[k]![key] += minutes * UNIT_SPLIT[i]!)));
  s.lines.forEach((u, i) =>
    u.forEach((k) => (s.skaters[k]!.toi = even * ICE_TIME.forwardLines[i]!)),
  );
  s.pairs.forEach((u, i) =>
    u.forEach((k) => (s.skaters[k]!.toi = even * ICE_TIME.defensePairs[i]!)),
  );
  add(s.ppUnits, ppMinutes, 'ppToi');
  add(s.pkUnits, pkMinutes, 'pkToi');
  for (const line of s.skaters) {
    line.toi = Math.round((line.toi + line.ppToi + line.pkToi) * 10) / 10;
    line.ppToi = Math.round(line.ppToi * 10) / 10;
    line.pkToi = Math.round(line.pkToi * 10) / 10;
  }
}

/** The skaters on the ice at even strength: a random forward line and defence pair, by ice time (empty lines never play). */
function onIce(s: Side, rng: Rng): number[] {
  const unit = (units: number[][], shares: readonly number[]) => {
    const weights = units.map((u, i) => (u.length ? shares[i]! : 0));
    return weights.some((w) => w > 0) ? units[pick(weights, rng)]! : [];
  };
  return [...unit(s.lines, ICE_TIME.forwardLines), ...unit(s.pairs, ICE_TIME.defensePairs)];
}

/**
 * Turns a game's team result into a box score: penalties, who shot (and on the power play), where
 * from, who scored and assisted, ice time with special teams, plus-minus and the goalies' saves. The
 * totals are decided first (goals and shots per team); this only says how they happened, so team
 * balance is not touched. Power plays shift who scores, not how much.
 * A skater may get hurt at a random minute: he leaves the game (his ice time shrinks and he takes
 * no later shots, goals or assists) and the hurt players are returned for the engine to act on.
 * A goalie hurt in a game is hurt at the final horn (he plays all 60 minutes).
 * TODO(M2): power-play quality changing a team's goals, majors and fights, empty-net goals,
 * a real xG model (ONNX).
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
): { box: HockeyBoxScore; injuries: { playerId: PlayerId; days: number }[] } {
  const sides = [side(game.home, game.homeBackup), side(game.away, game.awayBackup)] as const;
  const shots: HockeyShot[] = [];

  // Penalties first: they decide how long each team spends on the power play and penalty kill.
  const penalties: HockeyPenalty[] = [];
  const taken = sides.map((s) => (s.players.length ? rng.poisson(PENALTIES_PER_TEAM) : 0));
  sides.forEach((s, n) => {
    for (let i = 0; i < taken[n]!; i++) {
      const k = pick(
        s.players.map((p) => rating(p, 'physical') / 50),
        rng,
      );
      penalties.push([rng.int(0, 3599), n as 0 | 1, k, PENALTY_MINUTES]);
      s.skaters[k]!.pim += PENALTY_MINUTES;
    }
  });
  const ppMinutes = [0, 1].map((n) => taken[1 - n]! * PENALTY_MINUTES);
  sides.forEach((s, n) => setIceTime(s, ppMinutes[n]!, taken[n]! * PENALTY_MINUTES));

  // Injuries: skater index -> second he left the game, per side.
  const left = sides.map(() => new Map<number, number>());
  const injuries: { playerId: PlayerId; days: number }[] = [];
  sides.forEach((s, n) =>
    s.skaters.forEach((line, k) => {
      if (!rng.chance((INJURY_PER_GAME * line.toi) / AVG_TOI)) return;
      left[n]!.set(k, rng.int(0, 3599));
      const [lo, hi] =
        INJURY_DAYS[
          pick(
            INJURY_DAYS.map((t) => t.weight),
            rng,
          )
        ]!.days;
      injuries.push({ playerId: s.players[k]!.id, days: rng.int(lo, hi) });
    }),
  );
  sides.forEach((s) => {
    if (s.goalie && rng.chance(GOALIE_INJURY_PER_GAME)) {
      const [lo, hi] =
        INJURY_DAYS[
          pick(
            INJURY_DAYS.map((t) => t.weight),
            rng,
          )
        ]!.days;
      injuries.push({ playerId: s.goalie.id, days: rng.int(lo, hi) });
    }
  });
  /** A forward or defenceman from the deepest line who is not already in `unit` and has not left. */
  const spare = (n: number, k: number, unit: number[], time: number) => {
    const s = sides[n]!;
    const group = (s.pairs.some((p) => p.includes(k)) ? s.pairs : s.lines).flat();
    return group.filter((j) => !unit.includes(j) && (left[n]!.get(j) ?? Infinity) > time).at(-1);
  };
  /** The skaters really on the ice at `time`: anyone who has left is replaced by a deep-bench spare. */
  const fill = (n: number, unit: number[], time: number) => {
    const out = [...unit];
    out.forEach((k, i) => {
      if ((left[n]!.get(k) ?? Infinity) > time) return;
      out[i] = spare(n, k, out, time) ?? k; // nobody left to step in: he stays (very rare)
    });
    return out;
  };
  // An injured skater plays only until he left; the spare who steps in gets those minutes.
  left.forEach((gone, n) =>
    gone.forEach((second, k) => {
      const line = sides[n]!.skaters[k]!;
      const lost = {
        toi: (line.toi * (3600 - second)) / 3600,
        ppToi: (line.ppToi * (3600 - second)) / 3600,
        pkToi: (line.pkToi * (3600 - second)) / 3600,
      };
      const sub = spare(n, k, [], 3600);
      for (const key of ['toi', 'ppToi', 'pkToi'] as const) {
        line[key] = Math.round((line[key] - lost[key]) * 100) / 100;
        if (sub !== undefined) {
          sides[n]!.skaters[sub]![key] =
            Math.round((sides[n]!.skaters[sub]![key] + lost[key]) * 100) / 100;
        }
      }
    }),
  );

  for (const [n, attack] of sides.entries()) {
    if (attack.players.length === 0) continue; // nobody to credit
    const defend = sides[1 - n]!;
    const key = n === 0 ? 'home' : 'away';
    const overtime = game.overtimeGoal === key ? 1 : 0;
    const goals = game.goals[key] - overtime;
    const regular = Math.max(goals, game.shots[key] - overtime);
    const pp = ppMinutes[n]!;
    const ppShotShare = (pp * PP_SHOT_RATE) / (pp * PP_SHOT_RATE + (60 - pp));
    const againstUs = penalties.filter((pen) => pen[1] !== n);

    const makeShot = (time: number, power: boolean) => {
      const chosen = power
        ? attack.ppUnits[
            pick(
              UNIT_SPLIT.map((w, i) => (attack.ppUnits[i]!.length ? w : 0)),
              rng,
            )
          ]!
        : onIce(attack, rng);
      const unit = fill(n, chosen, time);
      const weights = unit.map((k) => {
        const p = attack.players[k]!;
        const isDefense = attack.pairs.some((pair) => pair.includes(k));
        return (rating(p, 'shooting') / 50) ** SKILL_POWER * (isDefense ? D_SHOOTING : 1);
      });
      const shooter = unit[pick(weights, rng)]!;
      const distance = 8 + Math.min(52, Math.abs(rng.normal(0, 22)));
      const angle = rng.normal(0, 0.45 + distance / 100);
      // `+ 0` turns -0 into 0, which JSON would otherwise change on a save round trip.
      const x = Math.round(distance * Math.cos(angle)) + 0;
      const y = Math.round(distance * Math.sin(angle)) + 0;
      const quality =
        shotQuality(x, y) *
        (rating(attack.players[shooter]!, 'shooting') / 65) *
        (power ? PP_SHOT_QUALITY : 1);
      return Object.assign(
        [time, n as 0 | 1, x, y, shooter, 0, -1, -1, power ? 1 : 0] as HockeyShot,
        { quality, unit },
      );
    };

    const made = Array.from({ length: regular }, () => {
      const power = againstUs.length > 0 && rng.chance(ppShotShare);
      // A power-play shot happens while one of the other team's penalties is running.
      const time = power
        ? rng.pick(againstUs)[0] + rng.int(0, PENALTY_MINUTES * 60 - 1)
        : rng.int(0, 3599);
      return makeShot(Math.min(time, 3599), power);
    });
    // The goals come from the best chances: pick shots by quality, without repeats.
    const open = made.map((_, i) => i);
    const scoring = new Set<number>();
    for (let g = 0; g < goals; g++) {
      const at = pick(
        open.map((i) => made[i]!.quality),
        rng,
      );
      scoring.add(open.splice(at, 1)[0]!);
    }
    if (overtime) {
      made.push(makeShot(3600 + rng.int(...OVERTIME_SECONDS), false));
      scoring.add(made.length - 1);
    }

    made.forEach((shot, i) => {
      attack.skaters[shot[4]]!.shots++;
      if (!scoring.has(i)) return;
      shot[5] = 1;
      attack.skaters[shot[4]]!.goals++;
      const others = shot.unit.filter((k) => k !== shot[4]);
      for (const slot of [6, 7] as const) {
        if (!others.length || !rng.chance(ASSIST[slot - 6]!)) break;
        const k = others.splice(
          pick(
            others.map((o) => (rating(attack.players[o]!, 'passing') / 50) ** SKILL_POWER),
            rng,
          ),
          1,
        )[0]!;
        shot[slot] = k;
        attack.skaters[k]!.assists++;
      }
      if (shot[8] === 1) {
        // Plus-minus ignores power-play goals.
        attack.skaters[shot[4]]!.ppGoals++;
        return;
      }
      for (const k of shot.unit) attack.skaters[k]!.plusMinus++;
      for (const k of fill(1 - n, onIce(defend, rng), shot[0])) defend.skaters[k]!.plusMinus--;
    });
    shots.push(...made.map((s) => [...s.slice(0, 9)] as HockeyShot));
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
    box: {
      home: { skaters: sides[0].skaters, goalie: goalie(sides[0], 'away') },
      away: { skaters: sides[1].skaters, goalie: goalie(sides[1], 'home') },
      shots: shots.sort((a, b) => a[0] - b[0]),
      penalties: penalties.sort((a, b) => a[0] - b[0]),
    },
    injuries,
  };
}
