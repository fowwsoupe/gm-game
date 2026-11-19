import { TIRED_GOALIE } from '@gm/shared';
import type {
  GameId,
  GameResult,
  HockeyBoxScore,
  HockeyGameStats,
  HockeyPenalty,
  HockeyShot,
  Player,
  PlayerId,
  TeamId,
} from '@gm/shared';
import type { Rng } from '../../core';
import {
  FACEOFF_WEIGHT,
  goalieScore,
  mean,
  rating,
  UNIT_WEIGHT,
  type TeamStrength,
} from './strength';
import { HOCKEY_TUNING, rulesGoalModel, type GoalModel } from './tuning';
import { finishBox, makeSide } from './side';
import { buildUnit, pick } from './units';
import { playShootout } from './shootout';

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
/**
 * Re-injury risk: a skater already hurt this season is hurt more easily again (a tweak that
 * comes back), and a long injury record adds a little more. Capped at double.
 */
const RE_INJURY = 0.3;
const PER_PAST_INJURY = 0.03;
const MAX_INJURY_RISK = 2;
export const injuryRisk = (p: Player, medical = 1): number =>
  Math.min(
    MAX_INJURY_RISK,
    1 +
      ((p.injuredUntil !== undefined ? RE_INJURY : 0) +
        PER_PAST_INJURY * (p.injuryHistory?.count ?? 0)) *
        medical,
  );
const REGULATION = 3600;
const PLAYOFF_OVERTIME = 1200;

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
    /** Medical factor on re-injury risk, home and away. */
    medical: [number, number];
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

  /** Seconds before the end of regulation a side pulls its goalie (down one or two), else 0. */
  const pullWindow = (n: 0 | 1) => {
    const down = goals[1 - n]! - goals[n];
    return down >= 1 && down <= 2 ? T.pullSeconds[down - 1]! : 0;
  };

  /** Puts out new units for the situation and recomputes every rate. */
  const refresh = (regulation: boolean, allowPenalties: boolean) => {
    for (const n of [0, 1] as const) {
      const s = S[n];
      const window = pullWindow(n);
      s.pulled = regulation && window > 0 && t >= REGULATION - window && s.current >= 0;
    }
    for (const n of [0, 1] as const) {
      const mine = count(n);
      const theirs = count((1 - n) as 0 | 1);
      const kind = mine > theirs ? 'pp' : mine < theirs ? 'pk' : 'ev';
      S[n].onIce = buildUnit(S[n], kind, mine + (S[n].pulled ? 1 : 0), rng);
      const f = S[n].onIce.filter((k) => !S[n].isD[k]);
      const d = S[n].onIce.filter((k) => S[n].isD[k]);
      // The first forward takes the draws (his line's centre), as in the team strength numbers.
      const draws = FACEOFF_WEIGHT * ((S[n].draw[f[0]!] ?? 50) - 50);
      const w = (fs: number[], ds: number[], wt: { forwards: number; defense: number }) =>
        wt.forwards * mean(fs) + wt.defense * mean(ds);
      // The line's and the pair's own bonus (builds fit): the mean over who is out there.
      const unit = (bonus: number[]) =>
        (f.length ? mean(f.map((k) => bonus[k] ?? 0)) : 0) +
        (d.length ? mean(d.map((k) => bonus[k] ?? 0)) : 0);
      S[n].uAtk =
        w(
          f.map((k) => S[n].atk[k]!),
          d.map((k) => S[n].atk[k]!),
          UNIT_WEIGHT.offense,
        ) +
        draws +
        S[n].chem +
        unit(S[n].unitAtk);
      S[n].uDef =
        w(
          f.map((k) => S[n].def[k]!),
          d.map((k) => S[n].def[k]!),
          UNIT_WEIGHT.defense,
        ) +
        draws +
        S[n].chem +
        unit(S[n].unitDef);
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
        if (
          !rng.chance(
            (INJURY_PER_GAME * injuryRisk(s.players[k]!, input.medical[n]) * T.shiftSeconds) /
              (AVG_TOI * 60),
          )
        )
          continue;
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
    const distance =
      8 + Math.min(52, Math.abs(rng.normal(0, 22 * att.traits[shooter]!.shotSpread)));
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
          s.onIce.map((j) => (s.phys[j]! / 50) * s.traits[j]!.penaltyWeight),
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
          const window = pullWindow(n);
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
      if (overtimeGoal === null) shootoutWinner = playShootout(S, rng, goalFactor);
    }
  }

  return {
    goals,
    shots: shotCount,
    overtimeGoal,
    shootoutWinner,
    overtime,
    ...(input.keepBox ? { box: finishBox(S, shots, penalties, emptyNet) } : {}),
    injuries,
  };
}

interface MatchupInput {
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
  /** The starter is playing the second night of a back-to-back: he is a little worse. */
  homeTired?: boolean;
  awayTired?: boolean;
  /** The medical staff's factor on re-injury risk (1 = average, below 1 = better). */
  homeMedical?: number;
  awayMedical?: number;
}

export function simGame(
  input: MatchupInput,
  rng: Rng,
  model: GoalModel = rulesGoalModel,
): GameResult {
  const backup = (backToBack?: boolean) => !!backToBack && !input.playoff;
  const rested = (s: TeamStrength, tired?: boolean): TeamStrength => {
    const g = s.lineup.goalies[0];
    if (!tired || input.playoff || !g) return s;
    const ratings = Object.fromEntries(
      Object.entries(g.ratings).map(([k, v]) => [k, v * TIRED_GOALIE]),
    );
    return {
      ...s,
      lineup: { ...s.lineup, goalies: [{ ...g, ratings }, ...s.lineup.goalies.slice(1)] },
    };
  };
  const played = playGame(
    {
      home: rested(input.home, input.homeTired),
      away: rested(input.away, input.awayTired),
      homeBackup: backup(input.homeBackToBack),
      awayBackup: backup(input.awayBackToBack),
      medical: [input.homeMedical ?? 1, input.awayMedical ?? 1],
      playoff: !!input.playoff,
      keepBox: !input.resultOnly,
    },
    rng,
    model,
  );
  const shootout = played.shootoutWinner;
  const units = (s: TeamStrength) =>
    [...s.lineup.forwards, ...s.lineup.defense]
      .map((u) => u.map((p) => p.id))
      .filter((u) => u.length > 1);
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
    ...(input.resultOnly ? {} : { units: { home: units(input.home), away: units(input.away) } }),
  };
}
