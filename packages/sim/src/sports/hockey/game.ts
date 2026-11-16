import type {
  GameId,
  GameResult,
  HockeyBoxScore,
  HockeyGameStats,
  HockeyGoalieLine,
  HockeyPenalty,
  HockeyShot,
  HockeySkaterLine,
  Player,
  PlayerId,
  TeamId,
} from '@gm/shared';
import type { Rng } from '../../core';
import {
  attack,
  defence,
  faceoffs,
  FACEOFF_WEIGHT,
  goalieScore,
  ICE_TIME,
  rating,
  UNIT_WEIGHT,
  type TeamStrength,
} from './strength';

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
   */
  goalieFormSd: 0.14,
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
  /** Scales every shot's goal chance (the GoalModel's output) so the league saves about 90%. */
  xgScale: 1.02,
  /** A trailing team pulls its goalie this many seconds before the end: down one, down two. */
  pullSeconds: [150, 90],
  /** A team with its goalie pulled attacks this much harder than the extra skater alone explains. */
  pulledPace: 2,
  /** Score effects: a team shoots more (log, per goal down, up to two) when trailing and less when leading. */
  scoreEffect: 0.12,
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
export const shotQuality = (x: number, y: number) =>
  0.3 * Math.exp(-Math.hypot(x, y) / 22) * Math.max(0.2, x / Math.hypot(x, y));

export const rulesGoalModel: GoalModel = {
  shotXg: ({ x, y, shooting, power }) =>
    HOCKEY_TUNING.xgScale *
    shotQuality(x, y) *
    (shooting / 65) ** 0.7 *
    (power ? HOCKEY_TUNING.powerPlayQuality : 1),
};

/**
 * How much better team `a` is than team `b` at five-on-five, as the log of its goal ratio:
 * positive = `a` is better. For the balance lab and for odds; not used by the game itself.
 */
export const strengthEdge = (a: TeamStrength, b: TeamStrength): number =>
  HOCKEY_TUNING.ratingSensitivity * (a.offense - b.defense - (b.offense - a.defense)) +
  HOCKEY_TUNING.goalieSensitivity * (a.goaltending - b.goaltending);

// ---------- the play-by-play engine ----------

/** Who shoots: defencemen take far fewer shots than forwards. */
const D_SHOOTING = 0.35;
/** Talent concentrates: a 90 shooter takes and scores far more than twice a 60 shooter's goals. */
const SKILL_POWER = 3;
/** Chance a goal has a first and a second assist. */
const ASSIST = [0.93, 0.62] as const;
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
const REGULATION = 3600;
const PLAYOFF_OVERTIME = 1200;

/** Index of one weight picked in proportion to its size. */
function pick(weights: readonly number[], rng: Rng): number {
  let roll = rng.next() * weights.reduce((a, b) => a + b, 0);
  const i = weights.findIndex((w) => (roll -= w) < 0);
  return i < 0 ? weights.length - 1 : i;
}

interface Side {
  players: Player[];
  skaters: HockeySkaterLine[];
  /** Skater indexes of each forward line and defence pair. */
  lines: number[][];
  pairs: number[][];
  /** Penalty killers, two forwards per unit. */
  killers: number[][];
  isD: boolean[];
  /** Per-skater skills, by index. */
  atk: number[];
  def: number[];
  draw: number[];
  shoot: number[];
  pass: number[];
  phys: number[];
  /** The goalie who started and the one who can come in, and who is in now (-1 = nobody). */
  goalies: Player[];
  current: number;
  goalieLines: HockeyGoalieLine[];
  /** Goals the current goalie has let in. */
  against: number;
  /** Skaters who left the game hurt. */
  out: Set<number>;
  onIce: number[];
  /** Penalties running, soonest to end first: [end second, skater index]. */
  penalties: [number, number][];
  pulled: boolean;
  /** Team skills of the units on ice. */
  uAtk: number;
  uDef: number;
  /** Chemistry bonus added to every unit (rating points). */
  chem: number;
}

function makeSide(strength: TeamStrength, backup: boolean): Side {
  const { forwards, defense, goalies } = strength.lineup;
  const players: Player[] = [];
  const index = (unit: Player[]) => unit.map((p) => players.push(p) - 1);
  const lines = forwards.map(index);
  const pairs = defense.map(index);
  const killers = lines
    .flat()
    .sort((a, b) => rating(players[b]!, 'defense') - rating(players[a]!, 'defense') || a - b)
    .slice(0, 4);
  const start = backup && goalies.length > 1 ? 1 : 0;
  const order = goalies[start] ? [goalies[start]!, ...goalies.filter((_, i) => i !== start)] : [];
  const starter = order[0];
  return {
    players,
    lines,
    pairs,
    killers: [killers.slice(0, 2), killers.slice(2)],
    isD: players.map((_, k) => pairs.some((pr) => pr.includes(k))),
    atk: players.map(attack),
    def: players.map(defence),
    draw: players.map(faceoffs),
    shoot: players.map((p) => rating(p, 'shooting')),
    pass: players.map((p) => rating(p, 'passing')),
    phys: players.map((p) => rating(p, 'physical')),
    goalies: order.slice(0, 2),
    current: starter ? 0 : -1,
    goalieLines: starter ? [{ id: starter.id, toi: 0, shotsAgainst: 0, saves: 0 }] : [],
    against: 0,
    out: new Set(),
    onIce: [],
    penalties: [],
    pulled: false,
    uAtk: 50,
    uDef: 50,
    chem: strength.chemistry ?? 0,
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

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 50);

interface Played {
  /** Goals each side [home, away] counted in the score, not shootout goals. */
  goals: [number, number];
  shots: [number, number];
  /** The side that scored in overtime, if the game ended there. */
  overtimeGoal: 0 | 1 | null;
  /** The side that won the shootout, if there was one. */
  shootoutWinner: 0 | 1 | null;
  overtime: boolean;
  box?: HockeyBoxScore;
  injuries: { playerId: PlayerId; days: number }[];
}

/**
 * Plays a game as it happens. Time runs forward in competing random clocks (a shot for each
 * team, a penalty for each team); a shift ends every 45 seconds, when each coach sends out
 * a forward line and a defence pair by ice time, the power-play or penalty-kill unit when a
 * team is a man up or down. A shot's rate comes from the units on the ice (attack against
 * defence, man advantage, the faceoff man); its goal chance from where it is taken, who
 * shoots and the goalie in net. Goals, assists, ice time, plus-minus, saves, penalties, hurt
 * players, a pulled goalie and empty-net goals all come out of that, not the other way round.
 * Overtime is 3v3 sudden death (five-on-five periods in the playoffs), then a shootout.
 * `keepBox: false` (the fast mode) skips the box score and injuries but plays the same game.
 */
function playGame(
  input: {
    home: TeamStrength;
    away: TeamStrength;
    homeBackup: boolean;
    awayBackup: boolean;
    playoff: boolean;
    keepBox: boolean;
  },
  rng: Rng,
  model: GoalModel,
): Played {
  const T = HOCKEY_TUNING;
  const S = [
    makeSide(input.home, input.homeBackup),
    makeSide(input.away, input.awayBackup),
  ] as const;
  const goals: [number, number] = [0, 0];
  const shotCount: [number, number] = [0, 0];
  const emptyNet: [number, number] = [0, 0];
  const shots: HockeyShot[] = [];
  const penalties: HockeyPenalty[] = [];
  const injuries: { playerId: PlayerId; days: number }[] = [];
  const pickInjuryDays = () => {
    const [lo, hi] =
      INJURY_DAYS[
        pick(
          INJURY_DAYS.map((d) => d.weight),
          rng,
        )
      ]!.days;
    return rng.int(lo, hi);
  };
  const goalieSkill = (n: 0 | 1) => {
    const g = S[n].goalies[S[n].current];
    return g ? goalieScore(g) : 40;
  };
  // Goalie form: one draw per goalie per game, from its own stream so the rest of the game's
  // randomness stays where it was. A steadier goalie (higher `consistency`) swings less.
  const formRng = rng.fork('goalieForm');
  const form = S.map((s) =>
    s.goalies.map((g) =>
      formRng.normal(0, T.goalieFormSd * (1.5 - rating(g, 'consistency') / 100)),
    ),
  );
  const goalFactor = (n: 0 | 1) =>
    Math.exp(
      -T.goalieSensitivity * (goalieSkill(n) - T.leagueAvgGoaltending) +
        (form[n]![S[n].current] ?? 0),
    );

  let t = 0;
  /** Skaters per side from the base strength (5, or 3 in overtime) less penalties running. */
  let base = 5;
  const count = (n: 0 | 1) => Math.max(3, base - S[n].penalties.length);
  const lam: [number, number] = [0, 0];
  const penRate: [number, number] = [0, 0];

  /** A forward line and a defence pair, by ice time (empty ones never play). */
  const pickShare = (units: number[][], shares: readonly number[]) => {
    const weights = units.map((u, i) => (u.length ? shares[i]! : 0));
    return weights.some((w) => w > 0) ? pick(weights, rng) : -1;
  };
  /** A skater of the same kind who is healthy and not already out there; the deepest first. */
  const spare = (n: 0 | 1, k: number, unit: number[]) => {
    const s = S[n];
    const group = (s.isD[k] ? s.pairs : s.lines).flat();
    return group.filter((j) => !unit.includes(j) && !s.out.has(j)).at(-1);
  };
  const build = (n: 0 | 1, kind: 'ev' | 'pp' | 'pk', size: number): number[] => {
    const s = S[n];
    const nd = size >= 4 ? 2 : 1;
    const nf = size - nd;
    let f: number[];
    let d: number[];
    if (kind === 'ev') {
      const li = pickShare(s.lines, ICE_TIME.forwardLines);
      const pi = pickShare(s.pairs, ICE_TIME.defensePairs);
      f = li < 0 ? [] : s.lines[li]!.slice(0, nf);
      d = pi < 0 ? [] : s.pairs[pi]!.slice(0, nd);
      // An extra attacker (goalie pulled) is the best other forward still in the game.
      const extra = s.lines
        .flat()
        .filter((k) => !f.includes(k) && !s.out.has(k))
        .sort((a, b) => s.atk[b]! - s.atk[a]! || a - b);
      while (f.length < nf && extra.length) f.push(extra.shift()!);
    } else {
      const k = pick(
        UNIT_SPLIT.map((w, i) => (s.pairs[i]?.length || s.lines[i]?.length ? w : 0)),
        rng,
      );
      d = (s.pairs[k] ?? []).slice(0, nd);
      f = (kind === 'pp' ? (s.lines[k] ?? []) : (s.killers[k] ?? [])).slice(0, nf);
    }
    const unit = [...f, ...d];
    return unit
      .map((k) => (s.out.has(k) ? (spare(n, k, unit) ?? k) : k))
      .filter((k) => !S[n].out.has(k));
  };

  /** Puts out new units for the situation and recomputes every rate. */
  const refresh = (regulation: boolean, allowPenalties: boolean) => {
    for (const n of [0, 1] as const) {
      const s = S[n];
      const down = score(1 - n) - score(n);
      const window = down >= 1 && down <= 2 ? T.pullSeconds[down - 1]! : 0;
      s.pulled = regulation && window > 0 && t >= REGULATION - window && s.current >= 0;
    }
    for (const n of [0, 1] as const) {
      const mine = count(n);
      const kind =
        mine > count((1 - n) as 0 | 1) ? 'pp' : mine < count((1 - n) as 0 | 1) ? 'pk' : 'ev';
      S[n].onIce = build(n, kind, mine + (S[n].pulled ? 1 : 0));
      const f = S[n].onIce.filter((k) => !S[n].isD[k]);
      const d = S[n].onIce.filter((k) => S[n].isD[k]);
      // The first forward takes the draws (his line's centre), as in the team strength numbers.
      const draws = FACEOFF_WEIGHT * ((S[n].draw[f[0]!] ?? 50) - 50);
      const w = (fs: number[], ds: number[], wt: { forwards: number; defense: number }) =>
        wt.forwards * mean(fs) + wt.defense * mean(ds);
      S[n].uAtk =
        w(
          f.map((k) => S[n].atk[k]!),
          d.map((k) => S[n].atk[k]!),
          UNIT_WEIGHT.offense,
        ) +
        draws +
        S[n].chem;
      S[n].uDef =
        w(
          f.map((k) => S[n].def[k]!),
          d.map((k) => S[n].def[k]!),
          UNIT_WEIGHT.defense,
        ) +
        draws +
        S[n].chem;
    }
    for (const n of [0, 1] as const) {
      const o = (1 - n) as 0 | 1;
      const diff = count(n) + (S[n].pulled ? 1 : 0) - (count(o) + (S[o].pulled ? 1 : 0));
      lam[n] = S[n].onIce.length
        ? (T.shotsPer60 / 3600) *
          (n === 0 ? T.homeIceBoost : 1) *
          Math.exp(T.ratingSensitivity * (S[n].uAtk - S[o].uDef)) *
          Math.exp(T.manAdvantageStep * diff) *
          (base === 3 ? T.overtimePace : 1)
        : 0;
      penRate[n] = allowPenalties && S[n].penalties.length < 2 ? T.penaltiesPerTeam / 3600 : 0;
    }
  };
  const score = (n: number) => goals[n as 0 | 1];

  const account = (dt: number) => {
    for (const n of [0, 1] as const) {
      const s = S[n];
      const mine = count(n);
      const theirs = count((1 - n) as 0 | 1);
      for (const k of s.onIce) {
        const line = s.skaters[k]!;
        line.toi += dt;
        if (mine > theirs) line.ppToi += dt;
        else if (mine < theirs) line.pkToi += dt;
      }
      if (!s.pulled && s.current >= 0) s.goalieLines[s.current]!.toi += dt;
    }
  };

  /** Hurt players and goalie changes at a shift change. */
  const shiftChange = () => {
    if (!input.keepBox) return;
    for (const n of [0, 1] as const) {
      const s = S[n];
      for (const k of s.onIce) {
        if (!rng.chance((INJURY_PER_GAME * T.shiftSeconds) / (AVG_TOI * 60))) continue;
        s.out.add(k);
        injuries.push({ playerId: s.players[k]!.id, days: pickInjuryDays() });
      }
      const hurt =
        s.current >= 0 && rng.chance((GOALIE_INJURY_PER_GAME * T.shiftSeconds) / REGULATION);
      if (hurt) {
        injuries.push({ playerId: s.goalies[s.current]!.id, days: pickInjuryDays() });
        goalieIn(n);
      }
    }
  };
  /** The other goalie comes in, if there is one. */
  const goalieIn = (n: 0 | 1) => {
    const s = S[n];
    if (s.current !== 0 || !s.goalies[1]) return;
    s.current = 1;
    s.against = 0;
    s.goalieLines.push({ id: s.goalies[1].id, toi: 0, shotsAgainst: 0, saves: 0 });
  };

  /** One shot by side `a`. Returns true if it was a goal. */
  const shoot = (a: 0 | 1): boolean => {
    const o = (1 - a) as 0 | 1;
    const att = S[a];
    const def = S[o];
    const unit = att.onIce;
    const weights = unit.map(
      (k) => (att.shoot[k]! / 50) ** SKILL_POWER * (att.isD[k] ? D_SHOOTING : 1),
    );
    const shooter = unit[pick(weights, rng)]!;
    const distance = 8 + Math.min(52, Math.abs(rng.normal(0, 22)));
    const angle = rng.normal(0, 0.45 + distance / 100);
    // `+ 0` turns -0 into 0, which JSON would otherwise change on a save round trip.
    const x = Math.round(distance * Math.cos(angle)) + 0;
    const y = Math.round(distance * Math.sin(angle)) + 0;
    const power = count(a) > count(o);
    const empty = def.pulled || def.current < 0;
    const chance = empty
      ? T.emptyNetGoal
      : Math.min(0.9, model.shotXg({ x, y, shooting: att.shoot[shooter]!, power }) * goalFactor(o));
    const goal = rng.chance(chance);
    shotCount[a]++;
    att.skaters[shooter]!.shots++;
    const row: HockeyShot = [Math.round(t), a, x, y, shooter, goal ? 1 : 0, -1, -1, power ? 1 : 0];
    if (input.keepBox) shots.push(row);
    if (!empty) {
      const line = def.goalieLines[def.current]!;
      line.shotsAgainst++;
      if (!goal) line.saves++;
    }
    if (!goal) return false;

    goals[a]++;
    if (empty) emptyNet[a]++;
    else def.against++;
    att.skaters[shooter]!.goals++;
    const others = unit.filter((k) => k !== shooter);
    for (const slot of [6, 7] as const) {
      if (!others.length || !rng.chance(ASSIST[slot - 6]!)) break;
      const k = others.splice(
        pick(
          others.map((j) => (att.pass[j]! / 50) ** SKILL_POWER),
          rng,
        ),
        1,
      )[0]!;
      row[slot] = k;
      att.skaters[k]!.assists++;
    }
    if (power) {
      // A power-play goal ends the oldest minor the other team is serving; plus-minus ignores it.
      att.skaters[shooter]!.ppGoals++;
      def.penalties.shift();
    } else {
      for (const k of att.onIce) att.skaters[k]!.plusMinus++;
      for (const k of def.onIce) def.skaters[k]!.plusMinus--;
    }
    if (
      !empty &&
      def.current === 0 &&
      def.against >= 4 &&
      t < 2700 &&
      rng.chance(T.pulledAfterFour)
    ) {
      goalieIn(o);
    }
    return true;
  };

  const penalty = (n: 0 | 1) => {
    const s = S[n];
    if (!s.onIce.length) return;
    const k =
      s.onIce[
        pick(
          s.onIce.map((j) => s.phys[j]! / 50),
          rng,
        )
      ]!;
    s.penalties.push([t + T.penaltySeconds, k]);
    s.penalties.sort((a, b) => a[0] - b[0]);
    s.skaters[k]!.pim += 2;
    if (input.keepBox) penalties.push([Math.round(t), n, k, 2]);
  };

  /**
   * Plays from `t` to `end`. Returns the side that scored if `suddenDeath` and someone did.
   * `periodBase`: skaters per side before penalties (5, or 3 in overtime).
   */
  const run = (
    end: number,
    periodBase: number,
    opts: { regulation: boolean; penalties: boolean; suddenDeath: boolean },
  ): 0 | 1 | null => {
    base = periodBase;
    let shiftEnd = t;
    let dirty = true;
    while (t < end) {
      if (t >= shiftEnd) {
        if (t > 0) shiftChange();
        shiftEnd = Math.min(t + T.shiftSeconds, end);
        dirty = true;
      }
      if (dirty) {
        refresh(opts.regulation, opts.penalties);
        dirty = false;
      }
      const clocks = [lam[0], lam[1], penRate[0], penRate[1]];
      const total = clocks[0]! + clocks[1]! + clocks[2]! + clocks[3]!;
      let boundary = Math.min(end, shiftEnd);
      for (const s of S) if (s.penalties[0]) boundary = Math.min(boundary, s.penalties[0][0]);
      // The goalie is pulled at a set time, so it is a boundary too.
      if (opts.regulation) {
        for (const n of [0, 1] as const) {
          const down = score(1 - n) - score(n);
          const window = down >= 1 && down <= 2 ? T.pullSeconds[down - 1]! : 0;
          if (window && !S[n].pulled && S[n].current >= 0 && t < REGULATION - window)
            boundary = Math.min(boundary, REGULATION - window);
        }
      }
      const wait = total > 0 ? -Math.log(1 - rng.next()) / total : Infinity;
      if (t + wait >= boundary) {
        account(boundary - t);
        t = boundary;
        for (const s of S) {
          while (s.penalties[0] && s.penalties[0][0] <= t) s.penalties.shift();
        }
        dirty = true;
        continue;
      }
      account(wait);
      t += wait;
      const which = pick(clocks, rng);
      if (which >= 2) {
        penalty((which - 2) as 0 | 1);
        dirty = true;
        continue;
      }
      const scored = shoot(which as 0 | 1);
      if (scored) {
        if (opts.suddenDeath) return which as 0 | 1;
        dirty = true;
      }
    }
    return null;
  };

  run(REGULATION, 5, { regulation: true, penalties: true, suddenDeath: false });

  let overtimeGoal: 0 | 1 | null = null;
  let shootoutWinner: 0 | 1 | null = null;
  const overtime = goals[0] === goals[1];
  if (overtime) {
    if (input.playoff) {
      for (let i = 0; i < 12 && overtimeGoal === null; i++) {
        overtimeGoal = run(REGULATION + PLAYOFF_OVERTIME * (i + 1), 5, {
          regulation: false,
          penalties: true,
          suddenDeath: true,
        });
      }
      overtimeGoal ??= rng.chance(0.5) ? 0 : 1; // twelve scoreless periods: never in practice
    } else {
      for (const s of S) s.penalties.length = 0;
      overtimeGoal = run(REGULATION + T.overtimeSeconds, 3, {
        regulation: false,
        penalties: false,
        suddenDeath: true,
      });
      if (overtimeGoal === null) shootoutWinner = shootout();
    }
  }

  /** Three shooters each, then one at a time. Skill is shooting and hands. */
  function shootout(): 0 | 1 {
    const order = ([0, 1] as const).map((n) =>
      S[n].players
        .map((_, k) => k)
        .filter((k) => !S[n].out.has(k) && !S[n].isD[k])
        .sort(
          (a, b) =>
            S[n].shoot[b]! +
              rating(S[n].players[b]!, 'puckHandling') -
              (S[n].shoot[a]! + rating(S[n].players[a]!, 'puckHandling')) || a - b,
        ),
    );
    const tally = [0, 0];
    const taken = [0, 0];
    const attempt = (n: 0 | 1, round: number) => {
      const list = order[n]!;
      const k = list[round % Math.max(1, list.length)];
      const skill =
        k === undefined ? 50 : S[n].shoot[k]! + rating(S[n].players[k]!, 'puckHandling');
      const p = T.shootoutGoal * (skill / 130) ** 2 * goalFactor((1 - n) as 0 | 1);
      return rng.chance(Math.min(0.9, p));
    };
    for (let round = 0; round < 3; round++) {
      for (const n of [0, 1] as const) {
        if (attempt(n, round)) tally[n]!++;
        taken[n]!++;
        // Decided once the trailing side cannot catch up with the shots it has left.
        if (tally[0]! > tally[1]! + (3 - taken[1]!)) return 0;
        if (tally[1]! > tally[0]! + (3 - taken[0]!)) return 1;
      }
    }
    if (tally[0] !== tally[1]) return tally[0]! > tally[1]! ? 0 : 1;
    for (let round = 3; round < 40; round++) {
      const a = attempt(0, round);
      const b = attempt(1, round);
      if (a !== b) return a ? 0 : 1;
    }
    return rng.chance(0.5) ? 0 : 1;
  }

  const credited: [number, number] = [goals[0], goals[1]];
  const minutes = (sec: number) => Math.round((sec / 60) * 10) / 10;
  let box: HockeyBoxScore | undefined;
  if (input.keepBox) {
    for (const s of S) {
      for (const line of s.skaters) {
        line.toi = minutes(line.toi);
        line.ppToi = minutes(line.ppToi);
        line.pkToi = minutes(line.pkToi);
      }
      for (const line of s.goalieLines) line.toi = minutes(line.toi);
    }
    const side = (s: Side) => ({
      skaters: s.skaters,
      goalie: s.goalieLines[0] ?? { id: '', toi: 0, shotsAgainst: 0, saves: 0 },
      ...(s.goalieLines[1] ? { relief: s.goalieLines[1] } : {}),
    });
    box = {
      home: side(S[0]),
      away: side(S[1]),
      shots,
      penalties,
      ...(emptyNet[0] + emptyNet[1] > 0 ? { emptyNet } : {}),
    };
  }
  return {
    goals: credited,
    shots: shotCount,
    overtimeGoal,
    shootoutWinner,
    overtime,
    ...(box ? { box } : {}),
    injuries,
  };
}

export interface MatchupInput {
  id: GameId;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
  home: TeamStrength;
  away: TeamStrength;
  playoff?: boolean;
  /** Score and totals only, no box score or injuries: faster, for odds and what-if sims. */
  resultOnly?: boolean;
  /** The team played yesterday: its backup goalie starts (never in the playoffs). */
  homeBackToBack?: boolean;
  awayBackToBack?: boolean;
}

export function simGame(
  input: MatchupInput,
  rng: Rng,
  model: GoalModel = rulesGoalModel,
): GameResult {
  const backup = (backToBack?: boolean) => !!backToBack && !input.playoff;
  const played = playGame(
    {
      home: input.home,
      away: input.away,
      homeBackup: backup(input.homeBackToBack),
      awayBackup: backup(input.awayBackToBack),
      playoff: !!input.playoff,
      keepBox: !input.resultOnly,
    },
    rng,
    model,
  );
  const shootout = played.shootoutWinner;
  const stats: HockeyGameStats = {
    homeShots: played.shots[0],
    awayShots: played.shots[1],
    shootout: shootout === null ? 0 : 1,
  };
  return {
    id: input.id,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    homeScore: played.goals[0] + (shootout === 0 ? 1 : 0),
    awayScore: played.goals[1] + (shootout === 1 ? 1 : 0),
    overtime: played.overtime,
    stats,
    ...(played.box ? { box: played.box } : {}),
    ...(played.injuries.length ? { injuries: played.injuries } : {}),
  };
}
