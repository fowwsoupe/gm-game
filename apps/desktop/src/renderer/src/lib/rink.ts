import type { HockeyBoxScore, HockeyTimeline } from '@gm/shared';

/**
 * The match viewer's picture: where every disc and the puck are at game second `t`, from the box
 * score and its timeline alone. `scene` is a pure function with no state between frames and no
 * dice, so a pause, a change of speed or a replay cannot make it drift.
 *
 * Exact, from the sim: who is on the ice, each shot's second, place and shooter, the goals, the
 * penalties, the goalie leaving or changing, the shootout's attempts in order (who, goal or save).
 * Drawn, and feeding no number: where a disc stands between shots (a formation around the puck),
 * the puck's way from one shot to the next, a shootout shooter's way in from centre ice.
 *
 * The overlays read the same plan: the shots so far (`shotMarks`, `Scene.shots`), the strength and
 * the power-play clock (`strengthAt`), each bench's ice time so far (`iceTime`).
 *
 * Feet, centre ice at 0, 0: x from -100 to 100, y from -42.5 to 42.5, goal lines at x = ±89.
 * ponytail: the home side defends the left net all game; flip `dir` by period to change ends.
 */
export interface RinkGame {
  box: HockeyBoxScore;
  timeline: HockeyTimeline;
  /** Length of an overtime period (`GameDetail.overtimeSeconds`). */
  overtimeSeconds: number;
}

export interface Disc {
  side: 0 | 1;
  /** Index into his side's `skaters`; -1 for the goalie. */
  k: number;
  x: number;
  y: number;
  /** 1 on the ice (or sitting in the penalty box), less while he skates off. */
  alpha: number;
  /** In the penalty box, outside the boards. */
  box?: true;
  /** The goalie who came in (`relief` in the box score). */
  relief?: true;
}

export interface Scene {
  puck: Point;
  discs: Disc[];
  /** Goals so far, [home, away]: at every whole second, the box's. */
  score: [number, number];
  /** The side that scored in the last five seconds (a shootout goal too: it is in no score). */
  goal?: 0 | 1;
  /** How many of `shotMarks` are drawn so far: at every whole second, the box's shots up to it. */
  shots: number;
}

export interface Strength {
  /**
   * Skaters a side, [home, away], as the engine counts them: five (three in regular-season
   * overtime) less its penalties running, never under three, one more while its net is empty.
   */
  skaters: [number, number];
  /**
   * The side with the man advantage (the shots the box marks power play), and the seconds left
   * on the other side's oldest penalty: the scoreboard's clock, which a goal can cut short.
   */
  power?: { side: 0 | 1; left: number };
}

type Point = [number, number];
type Key = { t: number; x: number; y: number; hard: boolean };

const GOAL = 89;
/** Seconds a disc takes between the bench and its place. */
const GLIDE = 3;
/** Where a unit stands, in feet from the puck toward the net it attacks: forwards go to the puck, defence stays behind it. */
const FORWARDS: Point[] = [
  [-3, 0],
  [7, -20],
  [7, 20],
  [-9, 9],
  [-9, -9],
  [14, 0],
];
const DEFENCE: Point[] = [
  [-22, -13],
  [-22, 13],
  [-30, 0],
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: Point, b: Point, u: number): Point => [
  a[0] + (b[0] - a[0]) * u,
  a[1] + (b[1] - a[1]) * u,
];
const smooth = (u: number) => u * u * (3 - 2 * u);
/** A fixed number in [0, 1) for an event: variety without dice. */
const mix = (n: number) => {
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 2 ** 32;
};
/** The last item at or before `t` (items in time order), -1 if none. */
const lastAt = (items: readonly { t: number }[], t: number) => {
  let lo = -1;
  let hi = items.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (items[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

/** Off the ice by the door: across the ice to the boards in front of his seat, then through them. */
const door = (ice: Point, seat: Point, u: number): Point => {
  const gate: Point = [seat[0], clamp(seat[1], -40.5, 40.5)];
  return u < 0.8 ? lerp(ice, gate, u / 0.8) : lerp(gate, seat, (u - 0.8) / 0.2);
};

/** The nearest point inside the boards, 2 ft off them (the corners are 28 ft arcs). */
function inside(x: number, y: number): Point {
  x = clamp(x, -98, 98);
  y = clamp(y, -40.5, 40.5);
  const dx = Math.abs(x) - 72;
  const dy = Math.abs(y) - 14.5;
  const d = Math.hypot(dx, dy);
  if (dx <= 0 || dy <= 0 || d <= 26) return [x, y];
  return [Math.sign(x) * (72 + (dx / d) * 26), Math.sign(y) * (14.5 + (dy / d) * 26)];
}

interface Plan {
  /** The puck's way: a key at every shot's place (`hard`), softer ones before and after. */
  keys: Key[];
  /** A skater at the puck: the shooter at his shot, the assists before a goal. */
  touches: { t: number; side: 0 | 1; k: number; x: number; y: number }[];
  /** [draw time, side, 1 if it counts in the score] of each goal: a shootout goal only lights the net. */
  goals: [number, 0 | 1, 0 | 1][];
  /** Every shot of the box where it is drawn, in order. */
  shots: { t: number; x: number; y: number; side: 0 | 1; goal: boolean }[];
  /** The shootout's attempts, `t` the moment of the shot. */
  tries: { t: number; side: 0 | 1; k: number; goal: boolean }[];
  /** Each penalty as the engine runs it, and `due`, the end its clock shows (`sits` is who is seen in the box). */
  pens: { side: 0 | 1; from: number; to: number; due: number }[];
  /** Each side's units, a skater listed once, with the time the change is drawn. */
  rows: { t: number; second: number; unit: number[] }[][];
  /** Who sits in the penalty box, from when to when. */
  sits: { side: 0 | 1; k: number; from: number; to: number }[];
  /** Every moment something happens: reduced motion jumps from one to the next. */
  stops: number[];
}

const plans = new WeakMap<HockeyBoxScore, Plan>();

function plan({ box, timeline, overtimeSeconds }: RinkGame): Plan {
  const known = plans.get(box);
  if (known) return known;

  // Seconds are whole. Shots that share one are drawn in order inside it, the last on the second,
  // so the score at a whole second is the box's.
  const at = box.shots.map((s, i) => {
    let before = 0;
    let after = 0;
    while (box.shots[i - before - 1]?.[0] === s[0]) before++;
    while (box.shots[i + after + 1]?.[0] === s[0]) after++;
    return s[0] - after / (before + after + 1);
  });

  const rows = ([0, 1] as const).map((n) => {
    const out: Plan['rows'][number] = [];
    for (const [second, side, list] of timeline.shifts) {
      if (side !== n) continue;
      const unit = [...new Set(list)];
      const was = out.at(-1);
      // A shot and a change can share a second, either way round: the change is drawn on the
      // side of the shot that leaves its shooter on the ice.
      let t = second;
      box.shots.forEach((s, i) => {
        const stays = unit.includes(s[4]);
        if (s[0] !== second || s[1] !== n || stays === !!was?.unit.includes(s[4])) return;
        t = stays ? Math.min(t, at[i]!) : second + 0.5;
      });
      out.push({ t: Math.max(t, was?.t ?? -1), second, unit });
    }
    return out;
  });

  /** The net is empty: the goalie is pulled, or the side has none. */
  const open = (side: 0 | 1, second: number) => {
    const own = timeline.goalies.filter((r) => r[1] === side && r[0] <= second);
    return own.at(-1)?.[2] === 0 || !(side === 0 ? box.home : box.away).goalie.id;
  };

  const keys: Key[] = [{ t: -1, x: 0, y: 0, hard: true }];
  const touches: Plan['touches'] = [];
  const shots: Plan['shots'] = [];
  const add = (t: number, x: number, y: number, hard: boolean) => {
    [x, y] = inside(x, y);
    keys.push({ t, x, y, hard });
    return { t, x, y };
  };
  /** A later event wins over the tail of an earlier one; a shot's own place always stays. */
  const push = (t: number, x: number, y: number, hard = false) => {
    let n = keys.length;
    while (!keys[n - 1]!.hard && keys[n - 1]!.t >= t - 0.2) n--;
    if (!hard && t <= keys[n - 1]!.t + 0.2) return;
    keys.length = n;
    return add(t, x, y, hard);
  };
  /** The puck is at centre ice when a period starts, unless it is on its way from a shot. */
  const faceoff = (t: number) => keys.at(-1)!.t < t - 0.2 && add(t, 0, 0, false);
  const over = Math.max(box.shots.at(-1)?.[0] ?? 0, timeline.shifts.at(-1)?.[0] ?? 0);
  const starts = [1200, 2400];
  for (let t = 3600; t <= over; t += Math.max(60, overtimeSeconds)) starts.push(t);
  let next = 0;
  box.shots.forEach((s, i) => {
    for (; next < starts.length && starts[next]! < at[i]!; next++) faceoff(starts[next]!);
    const t = at[i]!;
    const side = s[1];
    const dir = side === 0 ? 1 : -1;
    const [x, y] = inside(dir * (GOAL - s[2]), dir * s[3]);
    const across = y > 0 ? -1 : 1;
    // A goal's way: second assist, first assist, shooter. Each pass comes from up ice.
    const second =
      s[7] >= 0 &&
      push(t - 3, x - dir * (20 + 14 * mix(4 * i + 1)), y - across * (10 + 12 * mix(4 * i + 2)));
    if (second) touches.push({ ...second, side, k: s[7] });
    const first =
      s[6] >= 0 &&
      push(t - 1.5, x - dir * (8 + 10 * mix(4 * i + 3)), y + across * (14 + 10 * mix(4 * i + 4)));
    if (first) touches.push({ ...first, side, k: s[6] });
    const here = push(t, x, y, true)!;
    touches.push({ ...here, side, k: s[4] });
    shots.push({ ...here, side, goal: s[5] === 1 });
    const fly = clamp(Math.hypot(dir * GOAL - x, y) / 110, 0.25, 0.6);
    if (s[5] === 1) {
      // In the net, then back to centre ice (an overtime goal ends the game: it stays in).
      push(t + fly, dir * (GOAL + 1.5), 0);
      push(t + 2.5, dir * (GOAL + 1.5), 0);
      if (s[0] < 3600) push(t + 5, 0, 0);
    } else if (open((1 - side) as 0 | 1, s[0])) {
      // Wide of the empty net.
      push(t + fly, dir * 98, (mix(4 * i + 1) < 0.5 ? -1 : 1) * (7 + 6 * mix(4 * i + 2)));
    } else {
      push(t + fly, dir * (GOAL - 2.5), clamp(y * 0.08, -2, 2));
    }
  });
  for (; next < starts.length; next++) faceoff(starts[next]!);

  // The shootout, ten seconds an attempt: everyone off, then one shooter at a time steps on, takes
  // the puck at centre ice and goes in on the other goalie. The order, the shooter and goal or
  // save are the sim's; the way in is drawn.
  const begin = 3600 + overtimeSeconds;
  if (timeline.shootout.length)
    for (const mine of rows) mine.push({ t: begin, second: begin, unit: [] });
  const tries = timeline.shootout.map(([side, k, scored], i) => {
    const from = begin + 10 * i;
    const t = from + 7;
    const dir = side === 0 ? 1 : -1;
    const x = dir * (GOAL - 10 - 8 * mix(7 * i + 5));
    const y = 12 * mix(7 * i + 6) - 6;
    const way = [push(from + 3, 0, 0, true)!, push(from + 5, x / 2, y / 2)!, push(t, x, y, true)!];
    // No forward left to send (`k` is -1): the puck goes in alone.
    if (k >= 0) {
      rows[side]!.push({ t: from, second: from, unit: [k] }, { t: t + 1, second: t + 1, unit: [] });
      for (const q of way) touches.push({ ...q, side, k });
    }
    push(t + 0.4, dir * (GOAL + (scored ? 1.5 : -2.5)), 0);
    if (scored) push(t + 2, dir * (GOAL + 1.5), 0);
    return { t, side, k, goal: scored === 1 };
  });

  // `due`: the end the scoreboard counts down to. Regular-season overtime starts with no penalty
  // running.
  const sits = box.penalties.map(([from, side, k, minutes]) => {
    const due = Math.min(from + minutes * 60, overtimeSeconds < 1200 && from < 3600 ? 3600 : 1e9);
    return { side, k, from, to: due, due };
  });
  // A power-play goal ends the oldest minor the other side is serving, sooner than the scoreboard said.
  box.shots.forEach((s, i) => {
    if (s[5] !== 1 || s[8] !== 1) return;
    const sit = sits.find((q) => q.side !== s[1] && q.from <= s[0] && q.to > s[0]);
    if (sit) sit.to = at[i]!;
  });
  const pens = sits.map(({ side, from, to, due }) => ({ side, from, to, due }));
  for (const sit of sits) {
    // He is out as soon as a unit has him again. The engine can send him out to kill his own
    // penalty: then he never sits. A row in the penalty's second counts only if it is the last.
    const mine = rows[sit.side]!;
    const back = mine.find(
      (r, j) => r.second >= sit.from && r.unit.includes(sit.k) && mine[j + 1]?.second !== sit.from,
    );
    if (back) sit.to = Math.min(sit.to, back.t);
  }

  const stops = [
    ...new Set([
      0,
      ...at,
      ...starts,
      ...rows.flat().map((r) => r.t),
      ...box.penalties.map((p) => p[0]),
      ...timeline.goalies.map((r) => r[0]),
      ...tries.flatMap((a) => [a.t - 4, a.t]),
    ]),
  ].sort((a, b) => a - b);
  const goals: Plan['goals'] = [
    ...shots.flatMap((s): Plan['goals'] => (s.goal ? [[s.t, s.side, 1]] : [])),
    ...tries.flatMap((a): Plan['goals'] => (a.goal ? [[a.t, a.side, 0]] : [])),
  ];
  const made = { keys, touches, goals, shots, tries, pens, rows, sits, stops };
  plans.set(box, made);
  return made;
}

function puckOn(keys: Key[], t: number): Point {
  const i = Math.max(0, lastAt(keys, t));
  const a = keys[i]!;
  const b = keys[i + 1];
  if (!b || t <= a.t) return [a.x, a.y];
  const u = (t - a.t) / (b.t - a.t);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  // A slow weave across the straight way from one key to the next, none at either end.
  const weave = length
    ? (Math.min(8, (b.t - a.t) * 0.6) * Math.sin(Math.PI * u) * Math.sin(a.t * 1.7 + t * 0.9)) /
      length
    : 0;
  return inside(a.x + dx * smooth(u) - dy * weave, a.y + dy * smooth(u) + dx * weave);
}

/** Where the puck is at `t`: at each shot's place at its second, on a smooth way in between. */
export const puckAt = (game: RinkGame, t: number) => puckOn(plan(game).keys, t);

/**
 * The picture at game second `t`. `calm` (reduced motion): the picture of the last event, so
 * discs jump from event to event and nothing glides.
 */
export function scene(game: RinkGame, t: number, calm = false): Scene {
  const { keys, touches, goals, shots, rows, sits, stops } = plan(game);
  if (calm) {
    let stop = 0;
    for (const s of stops) {
      if (s > t) break;
      stop = s;
    }
    t = stop;
  }
  const puck = puckOn(keys, t);
  const near = touches.filter((q) => q.t > t - 2.5 && q.t < t + 3);
  const discs: Disc[] = [];

  for (const n of [0, 1] as const) {
    const dir = n === 0 ? 1 : -1;
    const side = n === 0 ? game.box.home : game.box.away;
    const firstD = game.timeline.firstD[n];
    const mine = rows[n]!;
    const bench: Point = [dir * -16, 41];
    const cell: Point = [dir * -5, -45.5];
    /** Where he is when off the ice: the penalty box while he serves (and as he steps out), else the bench. */
    const rest = (k: number, when: number) =>
      sits.some((q) => q.side === n && q.k === k && q.from <= when && when <= q.to + 2)
        ? cell
        : bench;
    /** His touches around now, each with its weight: 1 at its moment, 0 three seconds before and 2.5 after. */
    const grip = (k: number) =>
      near
        .filter((q) => q.side === n && q.k === k)
        .map((q) => [1 - (q.t > t ? (q.t - t) / 3 : (t - q.t) / 2.5), q] as const);
    /** His place in the unit: around the puck, in the frame of the net his side attacks; at the puck when he touches it. */
    const spot = (unit: number[], k: number): Point => {
      const d = k >= firstD;
      const j = unit.filter((q) => q >= firstD === d).indexOf(k);
      const [fx, fy] = d ? DEFENCE[j % DEFENCE.length]! : FORWARDS[j % FORWARDS.length]!;
      const ahead = (d ? 0.7 : 0.88) * dir * puck[0] + fx + 1.2 * Math.sin(t * 0.4 + k * 2.4 + n);
      const across =
        (d ? 0.3 : j ? 0.35 : 0.85) * dir * puck[1] + fy + 1.2 * Math.cos(t * 0.31 + k * 1.7 + n);
      let [x, y] = inside(dir * clamp(ahead, -84, 84), dir * across);
      let sum = 1;
      for (const [w, q] of grip(k)) {
        if (w >= 1) return [q.x, q.y];
        const pull = w / (1 - w);
        x += pull * q.x;
        y += pull * q.y;
        sum += pull;
      }
      return [x / sum, y / sum];
    };
    /** Where he is as of unit `j`: at his place, or `GLIDE` seconds on his way to it or off. Null on the bench. */
    const where = (j: number, k: number): Point | null => {
      if (j < 0) return null;
      const row = mine[j]!;
      const to = row.unit.includes(k) ? spot(row.unit, k) : null;
      const e = j === 0 || calm ? 1 : (t - row.t) / GLIDE;
      if (e >= 1) return to;
      const from = where(j - 1, k);
      const u = smooth(e);
      if (from && to) return lerp(from, to, u);
      // A touch holds him on the ice: at its moment he is at the puck, wherever he was going.
      const hold = 1 - Math.max(0, ...grip(k).map(([w]) => w));
      if (to) return door(to, rest(k, row.t), (1 - u) * hold);
      return from && door(from, rest(k, t), u * hold);
    };
    const now = lastAt(mine, t);
    side.skaters.forEach((_, k) => {
      const at = where(now, k);
      if (!at) return;
      discs.push({ side: n, k, x: at[0], y: at[1], alpha: mine[now]!.unit.includes(k) ? 1 : 0.4 });
    });

    if (side.goalie.id) {
      const changes = game.timeline.goalies.filter((r) => r[1] === n && r[0] <= t);
      const last = changes.at(-1);
      const pulled = last?.[2] === 0;
      const e = !last || calm ? 1 : Math.min(1, (t - last[0]) / GLIDE);
      if (!pulled || e < 1) {
        const crease: Point = [dir * (4 - GOAL), clamp(puck[1] * 0.1, -3, 3)];
        const [x, y] = lerp(bench, crease, smooth(pulled ? 1 - e : e));
        const relief = changes.some((r) => r[2] === 2);
        discs.push({ side: n, k: -1, x, y, alpha: 1, ...(relief && { relief: true as const }) });
      }
    }

    let seated = 0;
    for (const q of sits) {
      if (q.side !== n || q.from > t || t >= q.to) continue;
      if (discs.some((d) => d.side === n && d.k === q.k)) continue;
      discs.push({
        side: n,
        k: q.k,
        x: cell[0] - dir * 5 * (seated++ % 3),
        y: cell[1],
        alpha: 1,
        box: true,
      });
    }
  }

  const score: [number, number] = [0, 0];
  let goal: 0 | 1 | undefined;
  for (const [when, side, counts] of goals) {
    if (when > t) break;
    score[side] += counts;
    if (t < when + 5) goal = side;
  }
  return { puck, discs, score, ...(goal !== undefined && { goal }), shots: lastAt(shots, t) + 1 };
}

/** Every shot of the box where the rink draws it, in order: the shots overlay shows the first `Scene.shots`. */
export const shotMarks = (game: RinkGame) => plan(game).shots;

/** The shootout's attempts in the timeline's order, `t` the moment each shot is drawn. */
export const attempts = (game: RinkGame) => plan(game).tries;

/** The strength at game second `t`, from the box's penalties and the timeline's empty nets. */
export function strengthAt(game: RinkGame, t: number): Strength {
  const { timeline, overtimeSeconds } = game;
  // Three a side: regular-season overtime, once the game has gone there.
  const three = overtimeSeconds < 1200 && t >= 3600 && (timeline.shifts.at(-1)?.[0] ?? 0) >= 3600;
  const running = ([0, 1] as const).map((n) =>
    plan(game).pens.filter((p) => p.side === n && p.from <= t && t < p.to),
  );
  const count = running.map((own) => Math.max(3, (three ? 3 : 5) - own.length));
  const skaters = count.map(
    (c, n) =>
      c + (timeline.goalies.filter((r) => r[1] === n && r[0] <= t).at(-1)?.[2] === 0 ? 1 : 0),
  ) as [number, number];
  if (count[0] === count[1]) return { skaters };
  const side = count[0]! > count[1]! ? 0 : 1;
  return { skaters, power: { side, left: Math.min(...running[1 - side]!.map((p) => p.due)) - t } };
}

/**
 * Each skater's ice time in seconds up to game second `t`, [home, away] by skater index: summed
 * from the timeline's shift rows as the engine counts them (a skater listed twice counts twice),
 * so at the end it is the box's `toi` within its rounding.
 */
export function iceTime({ box, timeline, overtimeSeconds }: RinkGame, t: number) {
  // The last second played: a shootout follows a full overtime, an overtime goal is the last shot.
  const end = timeline.shootout.length
    ? 3600 + overtimeSeconds
    : Math.max(3600, box.shots.at(-1)?.[0] ?? 0);
  return ([box.home, box.away] as const).map((side, n) => {
    const seconds = side.skaters.map(() => 0);
    const rows = timeline.shifts.filter((r) => r[1] === n);
    rows.forEach(([from, , unit], i) => {
      const on = Math.min(t, rows[i + 1]?.[0] ?? end) - from;
      if (on > 0) for (const k of unit) seconds[k]! += on;
    });
    return seconds;
  }) as [number[], number[]];
}

/**
 * The picture `u` of the way (0 to 1) from one scene to another: the puck, and each disc both
 * have. A bench order replaces the game under the clock, and with it the shot the play was
 * heading for; the rink shows this for a moment so nothing jumps.
 */
export const blend = (from: Scene, to: Scene, u: number): Scene => ({
  ...to,
  puck: lerp(from.puck, to.puck, smooth(u)),
  discs: to.discs.map((d) => {
    const was = from.discs.find((q) => q.side === d.side && q.k === d.k);
    if (!was) return d;
    const [x, y] = lerp([was.x, was.y], [d.x, d.y], smooth(u));
    return { ...d, x, y };
  }),
});
