import { describe, expect, it } from 'vitest';
import type { GameDetail, GameId, HockeyBoxScore, TeamId } from '@gm/shared';
import { createLeague, defaultContext, HOCKEY_TUNING, Rng, simGame, teamStrength } from '@gm/sim';
import fixture from '../preview/match.fixture.json';
import { sideColors } from './format';
import { puckAt, scene, type RinkGame } from './rink';

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
        for (let t = 0.5; t < endOf(g); t += 9.1) {
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

  it('gives two sides two colours, whatever their ids', () => {
    for (let i = 0; i < 32; i++)
      for (let j = 0; j < 32; j++) {
        const [one, other] = sideColors(`t${i}`, `t${j}`);
        expect(one).not.toBe(other);
      }
  });
});
