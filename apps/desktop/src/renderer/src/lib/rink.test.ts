import { describe, expect, it } from 'vitest';
import type { GameDetail, GameId, HockeyBoxScore, Team, TeamId } from '@gm/shared';
import { createLeague, defaultContext, HOCKEY_TUNING, Rng, simGame, teamStrength } from '@gm/sim';
import fixture from '../preview/match.fixture.json';
import { sideColors } from './format';
import {
  attempts,
  blend,
  iceTime,
  puckAt,
  scene,
  shotMarks,
  strengthAt,
  type RinkGame,
} from './rink';

/**
 * The rink's picture agrees with the box score and its timeline. The games are the pinned ones of
 * the sim's timeline test (league 41, Rng 9) plus the preview's fixture.
 */
const state = createLeague(41, defaultContext());
const [a, b] = Object.keys(state.teams) as TeamId[];
const strength = (id: TeamId) =>
  teamStrength(Object.values(state.players).filter((p) => p.teamId === id));
const home = strength(a!);
const away = strength(b!);
const play = (n: number, playoff: boolean): RinkGame[] => {
  const rng = new Rng(9);
  return Array.from({ length: n }, () => {
    const box = simGame(
      { id: 'g' as GameId, homeTeamId: a!, awayTeamId: b!, home, away, playoff, timeline: true },
      rng,
    ).box as HockeyBoxScore;
    const overtimeSeconds = playoff ? 1200 : HOCKEY_TUNING.overtimeSeconds;
    return { box, timeline: box.timeline!, overtimeSeconds };
  });
};
const detail = fixture as unknown as GameDetail;
const fixed = detail.result.box as HockeyBoxScore;
const preview: RinkGame = {
  box: fixed,
  timeline: fixed.timeline!,
  overtimeSeconds: detail.overtimeSeconds,
};
const games = [...play(120, false), ...play(40, true), preview];

const endOf = (g: RinkGame) =>
  Math.max(3600, g.box.shots.at(-1)?.[0] ?? 0, g.timeline.shifts.at(-1)?.[0] ?? 0) + 10;
/** Inside boards `inset` feet in from the real ones: a 200 x 85 ft sheet with 28 ft corners. */
const onIce = (x: number, y: number, inset = 0) => {
  const dx = Math.abs(x) - 72;
  const dy = Math.abs(y) - 14.5;
  return (
    Math.abs(x) <= 100 - inset &&
    Math.abs(y) <= 42.5 - inset &&
    (dx <= 0 || dy <= 0 || Math.hypot(dx, dy) <= 28 - inset)
  );
};
/** When each shot is drawn: shots sharing a second are spread evenly inside it, the last on the second. */
const drawTimes = (box: HockeyBoxScore) =>
  box.shots.map((s, i) => {
    const same = box.shots.filter((q) => q[0] === s[0]).length;
    const j = box.shots.slice(0, i).filter((q) => q[0] === s[0]).length;
    return s[0] - (same - 1 - j) / same;
  });

describe('rink scene', () => {
  it('is a function of the game and the second: the same picture every time', () => {
    for (const g of games.slice(0, 8)) {
      const copy = structuredClone(g);
      for (let t = -2; t < endOf(g); t += 13.7) {
        const first = scene(g, t);
        scene(g, t + 400);
        scene(g, t - 31.3, true);
        expect(scene(g, t)).toEqual(first);
        expect(scene(copy, t)).toEqual(first);
      }
    }
  });

  it('keeps the puck and every disc inside the boards, the penalised in their box above them', () => {
    let seated = 0;
    const wrong: unknown[] = [];
    games.forEach((g, i) => {
      const times = drawTimes(g.box);
      for (let t = 0; t < endOf(g); t += 2.3) times.push(t);
      for (const t of times) {
        const s = scene(g, t);
        if (!onIce(...s.puck)) wrong.push([i, t, 'puck', s.puck]);
        for (const d of s.discs) {
          // Outside the boards: only in a penalty box (the home side's on its half) or at its door.
          const boxed = d.y >= -48.5 && Math.abs(d.x) <= 16 && (d.side === 0 ? d.x < 0 : d.x > 0);
          const serving = g.box.penalties.some(
            (p) => p[1] === d.side && p[2] === d.k && p[0] <= t && t < p[0] + p[3] * 60,
          );
          if (d.box) seated++;
          if (d.box ? !serving || !boxed || d.y >= -42.5 : !onIce(d.x, d.y) && !boxed)
            wrong.push([i, t, d]);
        }
        if (new Set(s.discs.map((d) => `${d.side}:${d.k}`)).size !== s.discs.length)
          wrong.push([i, t, 'twice']);
      }
    });
    expect(wrong).toEqual([]);
    expect(seated).toBeGreaterThan(5000);
  });

  it('has the puck and the shooter at every shot place at its second', () => {
    let exact = 0;
    for (const g of games) {
      const times = drawTimes(g.box);
      g.box.shots.forEach((shot, i) => {
        const dir = shot[1] === 0 ? 1 : -1;
        const place = [dir * (89 - shot[2]), dir * shot[3]] as const;
        const s = scene(g, times[i]!);
        const shooter = s.discs.find((d) => d.side === shot[1] && d.k === shot[4] && !d.box);
        expect(shooter).toBeDefined();
        expect(Math.hypot(shooter!.x - s.puck[0], shooter!.y - s.puck[1])).toBeLessThan(1e-9);
        expect(puckAt(g, times[i]!)).toEqual(s.puck);
        const off = Math.hypot(s.puck[0] - place[0], s.puck[1] - place[1]);
        if (onIce(...place, 2)) {
          expect(off).toBeLessThan(1e-9);
          exact++;
        } else {
          // The box keeps the place the sim rolled, and some lie outside the boards: drawn at the
          // boards, no farther than the place is outside them (11 ft more in a rounded corner).
          const outside = Math.hypot(
            Math.max(0, Math.abs(place[0]) - 98),
            Math.max(0, Math.abs(place[1]) - 40.5),
          );
          expect(off).toBeLessThan(outside + 11);
          expect(onIce(...s.puck)).toBe(true);
        }
      });
    }
    expect(exact).toBeGreaterThan(5000);
  });

  it('shows on the ice exactly the unit of the last shift row', () => {
    for (const g of games) {
      for (const n of [0, 1] as const) {
        const rows = g.timeline.shifts.filter((r) => r[1] === n);
        // Up to the shootout, which has its own rows (one shooter at a time).
        const end = g.timeline.shootout.length ? 3600 + g.overtimeSeconds : endOf(g);
        for (let t = 0.5; t < end; t += 9.1) {
          // A change is drawn within a second of its row.
          if (rows.some((r) => Math.abs(r[0] - t) < 1)) continue;
          const unit = rows.filter((r) => r[0] <= t).at(-1)?.[2] ?? [];
          const shown = scene(g, t)
            .discs.filter((d) => d.side === n && d.k >= 0 && !d.box && d.alpha === 1)
            .map((d) => d.k);
          expect(shown.sort()).toEqual([...new Set(unit)].sort());
        }
      }
    }
  });

  it('has the score of the box at every whole second around a goal', () => {
    for (const g of games) {
      for (const [second] of g.box.shots.filter((s) => s[5] === 1)) {
        for (const t of [second - 1, second, second + 1]) {
          const goals = g.box.shots.filter((s) => s[5] === 1 && s[0] <= t);
          expect(scene(g, t).score).toEqual(
            [0, 1].map((n) => goals.filter((s) => s[1] === n).length),
          );
        }
      }
    }
  });

  it('takes the goalie off the ice when he is pulled', () => {
    // The fixture's home side pulls its goalie at 3482 and he never comes back.
    expect(preview.timeline.goalies).toEqual([[3482, 0, 0]]);
    const goalie = (t: number) => scene(preview, t).discs.some((d) => d.side === 0 && d.k === -1);
    expect(goalie(3400)).toBe(true);
    expect(goalie(3490)).toBe(false);
  });

  it('reduced motion: the picture of the last event, nobody on his way', () => {
    const { box, timeline } = preview;
    const events = new Set([
      ...box.shots.map((s) => s[0]),
      ...box.penalties.map((p) => p[0]),
      ...timeline.shifts.map((r) => r[0]),
      ...timeline.goalies.map((r) => r[0]),
    ]);
    let quiet = 0;
    let moving = 0;
    for (let t = 1; t < 3590; t++) {
      for (const d of scene(preview, t + 0.4, true).discs) expect(d.alpha).toBe(1);
      // An event is drawn within a second of its own: none here, so nothing may move.
      if ([t, t + 1, t + 2].some((u) => events.has(u) || u % 1200 === 0)) continue;
      expect(scene(preview, t + 0.9, true)).toEqual(scene(preview, t + 0.1, true));
      quiet++;
      // With motion the same stretch is animated.
      if (scene(preview, t + 0.9).puck[0] !== scene(preview, t + 0.1).puck[0]) moving++;
    }
    expect(quiet).toBeGreaterThan(1000);
    expect(moving).toBeGreaterThan(quiet / 2);
  });

  it('blends two pictures: the old places at 0, halfway at a half, the new discs all along', () => {
    // Two games of the same teams at the same second: what a bench order leaves the rink with.
    const from = scene(games[0]!, 700);
    const to = scene(games[1]!, 700);
    expect(blend(from, to, 0).puck).toEqual(from.puck);
    for (const u of [0, 0.5, 1]) {
      const s = blend(from, to, u);
      expect(s.discs.map((d) => [d.side, d.k])).toEqual(to.discs.map((d) => [d.side, d.k]));
      expect(s.puck[0]).toBeCloseTo(from.puck[0] + (to.puck[0] - from.puck[0]) * u, 9);
      s.discs.forEach((d, i) => {
        const was = from.discs.find((q) => q.side === d.side && q.k === d.k) ?? to.discs[i]!;
        expect(d.y).toBeCloseTo(was.y + (to.discs[i]!.y - was.y) * u, 9);
      });
    }
  });

  it('gives two sides two colours, whatever their ids', () => {
    for (let i = 0; i < 32; i++)
      for (let j = 0; j < 32; j++) {
        const [one, other] = sideColors([], `t${i}`, `t${j}`);
        expect(one).not.toBe(other);
      }
  });

  it("wears a roster file's colours: dark ones lifted off the ice, the away side's second when its first is too close", () => {
    const team = (id: string, primary: string, secondary: string) =>
      ({ id, colors: { primary, secondary } }) as Team;
    const teams = [
      team('black', '#000000', '#ffffff'),
      team('red', '#c8102e', '#ffb81c'),
      team('other-red', '#af1e2d', '#192168'),
    ];
    // Black keeps no hue and comes up to a grey the dark ice shows.
    expect(sideColors(teams, 'black', 'red')).toEqual(['hsl(0 0% 55%)', 'hsl(350 85% 55%)']);
    // Two reds: the visitors wear their navy (lifted), or their gold.
    expect(sideColors(teams, 'red', 'other-red')).toEqual(['hsl(350 85% 55%)', 'hsl(234 61% 55%)']);
    expect(sideColors(teams, 'other-red', 'red')).toEqual(['hsl(354 71% 55%)', 'hsl(41 100% 55%)']);
    // A team without colours in the file still gets its derived ones.
    expect(sideColors(teams, 'red', 't1')[1]).toBe(sideColors([], 'red', 't1')[1]);
  });
});

describe('rink overlays', () => {
  it('marks every shot of the box where the puck was, a goal as a goal', () => {
    for (const g of games) {
      const marks = shotMarks(g);
      expect(marks.map((m) => [m.side, m.goal])).toEqual(
        g.box.shots.map((s) => [s[1], s[5] === 1]),
      );
      for (const m of marks) expect(puckAt(g, m.t)).toEqual([m.x, m.y]);
      for (let t = 0; t < endOf(g); t += 61)
        expect(scene(g, t).shots).toBe(g.box.shots.filter((s) => s[0] <= t).length);
    }
  });

  it('counts the strength as the engine does: its power-play shots, its special-teams minutes, the bodies on the ice', () => {
    let shots = 0;
    let wrong = 0;
    let empty = 0;
    let off = 0;
    let early = 0;
    for (const g of games) {
      // The box marks a shot power play when its side had more skaters before penalties' ends
      // were rounded to the second: a shot in the second a penalty starts or ends can differ.
      shotMarks(g).forEach((m, i) => {
        const shot = g.box.shots[i]!;
        shots++;
        if ((strengthAt(g, m.t - 0.01).power?.side === shot[1]) !== (shot[8] === 1)) wrong++;
      });
      // The clock is the scoreboard's: a minor called with no other running has its two minutes
      // to go (less at the end of a regular-season third period), also when a goal will end it sooner.
      for (const [from, side, , minutes] of g.box.penalties) {
        const near = g.box.penalties.filter((p) => p[0] > from - 180 && p[0] <= from + 1);
        const full = Math.min(minutes * 60, g.overtimeSeconds < 1200 ? 3600 - from : 1e9);
        if (near.length > 1 || from >= 3600 || full <= 1) continue;
        const cut = (s: (typeof g.box.shots)[number]) =>
          s[1] !== side && s[5] === 1 && s[8] === 1 && s[0] > from + 1 && s[0] < from + full;
        if (g.box.shots.some(cut)) early++;
        expect(strengthAt(g, from + 0.5).power).toEqual({ side: 1 - side, left: full - 0.5 });
      }

      const sides = [g.box.home, g.box.away] as const;
      const special = sides.map((s) => s.skaters.map(() => [0, 0] as [number, number]));
      const end = g.timeline.shootout.length
        ? 3600 + g.overtimeSeconds
        : Math.max(3600, g.box.shots.at(-1)?.[0] ?? 0);
      for (let t = 0.5; t < end; t++) {
        const now = strengthAt(g, t);
        for (const n of [0, 1] as const) {
          const unit = g.timeline.shifts.filter((r) => r[1] === n && r[0] <= t).at(-1)?.[2] ?? [];
          if (now.power) for (const k of unit) special[n]![k]![now.power.side === n ? 0 : 1]++;
          if (now.power && !(now.power.left > 0)) off++;
          if (g.timeline.shifts.some((r) => Math.abs(r[0] - t) < 1)) continue;
          // The line says what is on the ice, but for one case: a net empty during a power play.
          // The engine counts the extra attacker in its shot rate, and its power-play unit has
          // five names and its penalty kill four, so nobody is named for him.
          const room = !now.power ? 6 : now.power.side === n ? 5 : 4;
          if (now.skaters[n] > room) empty++;
          if (unit.length !== Math.min(now.skaters[n], room)) off++;
        }
      }
      // The box keeps minutes to a tenth.
      sides.forEach((side, n) =>
        side.skaters.forEach((line, k) => {
          expect(Math.abs(special[n]![k]![0] / 60 - line.ppToi)).toBeLessThan(0.1);
          expect(Math.abs(special[n]![k]![1] / 60 - line.pkToi)).toBeLessThan(0.1);
        }),
      );
    }
    expect(shots).toBeGreaterThan(5000);
    expect(wrong).toBeLessThan(shots / 500);
    expect(off).toBe(0);
    expect(empty).toBeGreaterThan(100);
    expect(early).toBeGreaterThan(100);
  });

  it("adds up each skater's ice time to the box's, never more than the clock", () => {
    for (const g of games) {
      expect(iceTime(g, 0).flat().some(Boolean)).toBe(false);
      for (const t of [700, 2000, 3600])
        for (const seconds of iceTime(g, t).flat()) expect(seconds).toBeLessThanOrEqual(t);
      const done = iceTime(g, Infinity);
      [g.box.home, g.box.away].forEach((side, n) =>
        side.skaters.forEach((line, k) =>
          expect(Math.abs(done[n]![k]! / 60 - line.toi)).toBeLessThan(0.1),
        ),
      );
    }
  });

  it("plays the shootout in the sim's order: one shooter at a time at the puck, both goalies in, no goal in the score", () => {
    const shootouts = games.filter((g) => g.timeline.shootout.length);
    expect(shootouts.length).toBeGreaterThan(3);
    for (const g of shootouts) {
      const begin = 3600 + g.overtimeSeconds;
      const tries = attempts(g);
      expect(tries.map((x) => [x.side, x.k, x.goal ? 1 : 0])).toEqual(g.timeline.shootout);
      const score = scene(g, begin - 1).score;
      tries.forEach((x, i) => {
        expect(x.t).toBeGreaterThan(tries[i - 1]?.t ?? begin);
        const s = scene(g, x.t);
        const skaters = s.discs.filter((d) => d.k >= 0);
        expect(skaters.map((d) => [d.side, d.k, d.alpha])).toEqual([[x.side, x.k, 1]]);
        expect([skaters[0]!.x, skaters[0]!.y]).toEqual(s.puck);
        // In front of the net his side attacks (the home side's is the right one).
        expect((x.side === 0 ? 1 : -1) * s.puck[0]).toBeGreaterThan(60);
        expect(s.discs.filter((d) => d.k < 0).map((d) => d.side)).toEqual([0, 1]);
        expect(s.score).toEqual(score);
        expect(scene(g, x.t + 1).goal).toBe(x.goal ? x.side : undefined);
      });
    }
  });
});
