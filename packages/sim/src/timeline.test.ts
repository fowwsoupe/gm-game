import { describe, expect, it } from 'vitest';
import type { GameId, HockeyBoxScore, HockeyTimeline, TeamId } from '@gm/shared';
import { createLeague, defaultContext, HOCKEY_TUNING, Rng, simGame, teamStrength } from './index';

/**
 * The timeline a match viewer draws (`HockeyBoxScore.timeline`): asking for it changes nothing,
 * and it agrees with the box. The games are the pinned ones of game.test.ts (league 41, Rng 9).
 */
const state = createLeague(41, defaultContext());
const [a, b] = Object.keys(state.teams) as TeamId[];
const strength = (id: TeamId) =>
  teamStrength(Object.values(state.players).filter((p) => p.teamId === id));
const home = strength(a!);
const away = strength(b!);
/** `n` games on one stream, and the stream's next draw after them. */
const play = (n: number, input: { playoff?: boolean; timeline?: boolean }) => {
  const rng = new Rng(9);
  const games = Array.from({ length: n }, () =>
    simGame({ id: 'g' as GameId, homeTeamId: a!, awayTeamId: b!, home, away, ...input }, rng),
  );
  return { games, next: rng.next() };
};
const regular = play(1500, { timeline: true });
const playoff = play(300, { playoff: true, timeline: true });
const all = [...regular.games, ...playoff.games].map((g) => {
  const box = g.box as HockeyBoxScore;
  // The second the game ended: an overtime goal is its last shot, a shootout follows a full overtime.
  const end = !g.overtime
    ? 3600
    : g.stats.shootout
      ? 3600 + HOCKEY_TUNING.overtimeSeconds
      : box.shots.at(-1)![0];
  return { g, box, tl: box.timeline!, end };
});
const sideOf = (box: HockeyBoxScore, n: 0 | 1) => (n === 0 ? box.home : box.away);
const rowsOf = (tl: HockeyTimeline, n: 0 | 1) => tl.shifts.filter((r) => r[1] === n);

describe('game timeline', () => {
  it('asking for it changes nothing: the same result, the same box, the same draws', () => {
    for (const [drawn, input] of [
      [regular, {}],
      [playoff, { playoff: true }],
    ] as const) {
      const plain = play(drawn.games.length, input);
      expect(plain.next).toBe(drawn.next);
      for (const g of plain.games) expect((g.box as HockeyBoxScore).timeline).toBeUndefined();
      const stripped = drawn.games.map((g) => {
        const { timeline, ...box } = g.box as HockeyBoxScore;
        expect(timeline).toBeDefined();
        return { ...g, box };
      });
      expect(stripped).toEqual(plain.games);
    }
  });

  it('result-only has no box to keep it in', () => {
    const rng = new Rng(9);
    const g = simGame(
      {
        id: 'g' as GameId,
        homeTeamId: a!,
        awayTeamId: b!,
        home,
        away,
        resultOnly: true,
        timeline: true,
      },
      rng,
    );
    expect(g.box).toBeUndefined();
  });

  it('every shooter and assist is on the ice at his shot, within the one-second rounding', () => {
    const forwards = [home, away].map((s) => s.lineup.forwards.flat().length);
    for (const { box, tl } of all) {
      expect(tl.firstD).toEqual(forwards);
      for (const n of [0, 1] as const) {
        const rows = rowsOf(tl, n);
        const skaters = sideOf(box, n).skaters.length;
        // In order, and real skaters. Not checked: a skater listed once. The engine sends one spare
        // for two hurt teammates of a unit and counts him twice (it happens in these games); the
        // timeline shows what it did.
        const sound = rows.every(
          ([second, , unit], i) =>
            second >= (rows[i - 1]?.[0] ?? 0) && unit.every((k) => k >= 0 && k < skaters),
        );
        expect(sound).toBe(true);
        const off = box.shots.filter(([second, side, , , shooter, , first, other]) => {
          if (side !== n) return false;
          // The unit out before that second, or one sent out during it.
          const at = rows.findIndex((r) => r[0] >= second);
          const units = rows.slice(Math.max(0, (at < 0 ? rows.length : at) - 1));
          const there = [shooter, first, other].filter((k) => k >= 0);
          return !units.some((r) => r[0] <= second && there.every((k) => r[2].includes(k)));
        });
        expect(off).toEqual([]);
      }
    }
  });

  it('ice time summed from the shifts is the ice time in the box', () => {
    for (const { box, tl, end } of all) {
      for (const n of [0, 1] as const) {
        const rows = rowsOf(tl, n);
        const seconds = new Map<number, number>();
        rows.forEach(([from, , unit], i) => {
          const to = rows[i + 1]?.[0] ?? end;
          for (const k of unit) seconds.set(k, (seconds.get(k) ?? 0) + to - from);
        });
        // The box rounds to a tenth of a minute, the timeline to a second.
        sideOf(box, n).skaters.forEach((line, k) =>
          expect(Math.abs((seconds.get(k) ?? 0) / 60 - line.toi)).toBeLessThan(0.15),
        );
      }
    }
  });

  it('an empty net shows the extra skater at even strength, and six skaters mean an empty net', () => {
    let extra = 0;
    for (const { box, tl, end } of all) {
      for (const n of [0, 1] as const) {
        const rows = rowsOf(tl, n);
        const empty: [number, number][] = [];
        for (const [second, side, what] of tl.goalies) {
          if (side !== n || what === 2) continue;
          if (what === 0) empty.push([second, end]);
          else empty.at(-1)![1] = second;
        }
        for (const [second, , unit] of rows) {
          if (unit.length <= 5) continue;
          expect(unit).toHaveLength(6);
          expect(empty.some(([from, to]) => second >= from && second <= to)).toBe(true);
        }
        for (const [from, to] of empty) {
          // A power-play or penalty-kill unit keeps its five or four: only the shot rate counts the extra man.
          if (box.penalties.some((p) => p[0] <= to && p[0] + 121 >= from)) continue;
          expect(rows.some((r) => r[0] >= from && r[0] <= to && r[2].length === 6)).toBe(true);
          extra++;
        }
      }
    }
    expect(extra).toBeGreaterThan(300);
  });

  it('a goalie change is the relief in the box, a hurt skater is in the injuries and never comes back', () => {
    let changes = 0;
    let hurt = 0;
    for (const { g, box, tl } of all) {
      const ids: string[] = [];
      for (const n of [0, 1] as const) {
        const side = sideOf(box, n);
        const swaps = tl.goalies.filter((r) => r[1] === n && r[2] === 2).length;
        expect(swaps).toBe(side.relief ? 1 : 0);
        changes += swaps;
        for (const [second, , k] of tl.hurt.filter((r) => r[1] === n)) {
          ids.push(side.skaters[k]!.id);
          expect(rowsOf(tl, n).some((r) => r[0] > second && r[2].includes(k))).toBe(false);
        }
      }
      // Injured goalies are in the game's injuries too: they show as a goalie change.
      const skaters = new Set([...box.home.skaters, ...box.away.skaters].map((s) => s.id));
      const injured = (g.injuries ?? []).map((i) => i.playerId).filter((id) => skaters.has(id));
      expect(ids.sort()).toEqual(injured.sort());
      hurt += ids.length;
    }
    expect(changes).toBeGreaterThan(50);
    expect(hurt).toBeGreaterThan(50);
  });

  it('the shootout attempts give the winner, and only a shootout has any', () => {
    let shootouts = 0;
    for (const { g, tl } of all) {
      if (!g.stats.shootout) {
        expect(tl.shootout).toEqual([]);
        continue;
      }
      shootouts++;
      const scored = (n: 0 | 1) => tl.shootout.filter((r) => r[0] === n && r[2] === 1).length;
      expect(scored(0) > scored(1)).toBe(g.homeScore > g.awayScore);
      expect(scored(0)).not.toBe(scored(1));
      // Forwards only, as the engine sends them.
      for (const [n, k] of tl.shootout) expect(k >= 0 && k < tl.firstD[n]).toBe(true);
    }
    expect(shootouts).toBeGreaterThan(50);
  });

  it('stays a few kilobytes a game', () => {
    const sizes = all.map(({ tl }) => JSON.stringify(tl).length);
    expect(sizes.reduce((x, y) => x + y, 0) / sizes.length).toBeLessThan(6_000);
  });
});
