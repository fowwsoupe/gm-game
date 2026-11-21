import { describe, expect, it } from 'vitest';
import { BENCH_ORDERS, MATCH_LINES } from '@gm/shared';
import type {
  Actor,
  BenchOrder,
  CommandResult,
  GameId,
  GameResult,
  HockeyBoxScore,
  TeamId,
} from '@gm/shared';
import {
  applyEvent,
  createLeague,
  defaultContext,
  handleCommand,
  HOCKEY_TUNING,
  ICE_TIME,
  Rng,
  simGame,
  teamStrength,
  watchGame,
} from './index';

/**
 * Coaching from the bench (`bench.order`, `BENCH_ORDERS`): a game without orders is the game as
 * it was, an order leaves the game before its second alone, and orders go through commands and
 * events like everything else. The games are between the pinned teams of game.test.ts (league 41).
 */
const ctx = defaultContext();
const pinned = createLeague(41, ctx);
const [a, b] = Object.keys(pinned.teams) as TeamId[];
const strength = (id: TeamId) =>
  teamStrength(Object.values(pinned.players).filter((p) => p.teamId === id));
const input = {
  id: 'g' as GameId,
  homeTeamId: a!,
  awayTeamId: b!,
  home: strength(a!),
  away: strength(b!),
  timeline: true,
};
const game = (seed: number, orders?: BenchOrder[], playoff = false) =>
  simGame({ ...input, playoff, orders }, new Rng(seed));
const boxOf = (g: GameResult) => g.box as HockeyBoxScore;
const goalieRows = (g: GameResult) => boxOf(g).timeline!.goalies;

describe('bench orders in the game sim', () => {
  it('with no orders a game is the game as it was, draw for draw', () => {
    for (const playoff of [false, true]) {
      const plain = new Rng(9);
      const none = new Rng(9);
      for (let i = 0; i < 300; i++) {
        expect(simGame({ ...input, playoff, orders: [] }, none)).toEqual(
          simGame({ ...input, playoff }, plain),
        );
      }
      expect(none.next()).toBe(plain.next());
    }
  });

  it('the game before an order is untouched, over many seeds and random orders', () => {
    const dice = new Rng(4);
    let changed = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const orders: BenchOrder[] = Array.from({ length: dice.int(1, 3) }, () => {
        const order = dice.pick(BENCH_ORDERS);
        return {
          teamId: dice.chance(0.5) ? a! : b!,
          at: dice.int(0, 3700),
          order,
          ...(order === 'match' && { value: dice.int(0, MATCH_LINES) }),
        };
      }).sort((x, y) => x.at - y.at);
      const first = orders[0]!.at;
      // Every row the game wrote before that second: shots, penalties and the timeline's.
      const before = (g: GameResult) => {
        const { shots, penalties, timeline } = boxOf(g);
        return [shots, penalties, timeline!.shifts, timeline!.goalies, timeline!.hurt].map((rows) =>
          (rows as [number, ...unknown[]][]).filter((r) => r[0] < first),
        );
      };
      const plain = game(seed, undefined, seed % 4 === 0);
      const coached = game(seed, orders, seed % 4 === 0);
      expect(before(coached)).toEqual(before(plain));
      if (JSON.stringify(coached) !== JSON.stringify(plain)) changed++;
    }
    // An order past the final horn does nothing; any other one makes the rest another game.
    expect(changed).toBeGreaterThan(500);
  });

  it('the net is the coach\'s once he says so: never empty with "goalieBack", empty exactly while he trails with "emptyNet"', () => {
    let pulls = 0;
    let open = 0;
    for (let seed = 1; seed <= 300; seed++) {
      pulls += goalieRows(game(seed)).filter((r) => r[2] === 0).length;
      const back = game(seed, [
        { teamId: a!, at: 0, order: 'goalieBack' },
        { teamId: b!, at: 0, order: 'goalieBack' },
      ]);
      expect(goalieRows(back).filter((r) => r[2] !== 2)).toEqual([]);
      expect(boxOf(back).emptyNet).toBeUndefined();

      // The visitors' goals while the home side trailed went into its empty net, and no others.
      const box = boxOf(game(seed, [{ teamId: a!, at: 0, order: 'emptyNet' }]));
      const score = [0, 0];
      let trailing = 0;
      for (const s of box.shots.filter((x) => x[5] === 1)) {
        if (s[1] === 1 && score[0]! < score[1]!) trailing++;
        score[s[1]]!++;
      }
      expect(box.emptyNet?.[1] ?? 0).toBe(trailing);
      open += trailing;
    }
    expect(pulls).toBeGreaterThan(50);
    expect(open).toBeGreaterThan(50);
  });

  it('"goalieChange" brings the other goalie in at that second, once', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const at = 60 + seed * 15;
      const ruled = goalieRows(game(seed)).find((r) => r[1] === 0 && r[2] === 2);
      const coached = game(seed, [
        { teamId: a!, at, order: 'goalieChange' },
        { teamId: a!, at: at + 300, order: 'goalieChange' },
      ]);
      const swaps = goalieRows(coached).filter((r) => r[1] === 0 && r[2] === 2);
      expect(swaps).toHaveLength(1);
      // Unless the rule or an injury already had before the order.
      expect(swaps[0]![0]).toBe(ruled && ruled[0] < at ? ruled[0] : at);
      expect(boxOf(coached).home.relief).toBeDefined();
    }
  });

  it('"match": the line the home coach names answers the visitors\' first line at five-on-five, and plays its minutes', () => {
    expect(ICE_TIME.forwardLines).toHaveLength(MATCH_LINES);
    const named = 3;
    const match = (teamId: TeamId, value: number): BenchOrder => ({
      teamId,
      at: 0,
      order: 'match',
      value,
    });
    const seeds = Array.from({ length: 300 }, (_, i) => i + 1);
    const plain = seeds.map((seed) => game(seed));
    const coached = seeds.map((seed) => game(seed, [match(a!, named)]));
    /** Each skater's forward line, by his index in the box (forwards come first). */
    const lineOf = (n: 0 | 1) =>
      (n === 0 ? input.home : input.away).lineup.forwards.flatMap((line, i) => line.map(() => i));
    /** Each forward line's share of its side's even-strength ice time over the games. */
    const shares = (games: GameResult[], n: 0 | 1) => {
      const by = ICE_TIME.forwardLines.map(() => 0);
      for (const g of games) {
        const side = n === 0 ? boxOf(g).home : boxOf(g).away;
        lineOf(n).forEach((line, k) => {
          const s = side.skaters[k]!;
          by[line]! += s.toi - s.ppToi - s.pkToi;
        });
      }
      const all = by.reduce((x, y) => x + y, 0);
      return by.map((m) => m / all);
    };
    // As the shares say: the named line plays the first line's share, and the rest of the time
    // goes to the other lines by theirs. Within 0.015: the match is five-on-five's only, and
    // even strength is also four-on-four, overtime and the extra attacker.
    const [first, second, third, fourth] = ICE_TIME.forwardLines;
    const rest = (1 - first) / (1 - third);
    const want = [first * rest, second * rest, first, fourth * rest];
    shares(coached, 0).forEach((share, i) =>
      expect(Math.abs(share - want[i]!)).toBeLessThan(0.015),
    );
    const visitors = seeds.map((seed) => game(seed, [match(b!, named)]));
    for (const [games, n] of [
      [plain, 0],
      [coached, 1],
      // Called off, and the visitors' coach (he has no last change): the usual shares, both sides.
      [seeds.map((seed) => game(seed, [match(a!, named), match(a!, 0)])), 0],
      [visitors, 0],
      [visitors, 1],
    ] as const) {
      shares(games, n).forEach((share, i) =>
        expect(Math.abs(share - ICE_TIME.forwardLines[i]!)).toBeLessThan(0.015),
      );
    }

    let answered = 0;
    let unmatched = 0;
    let counted = 0;
    for (const g of coached) {
      const box = boxOf(g);
      const tl = box.timeline!;
      const end = !g.overtime
        ? 3600
        : g.stats.shootout
          ? 3600 + HOCKEY_TUNING.overtimeSeconds
          : box.shots.at(-1)![0];
      // The box still adds up, from the units the timeline has.
      for (const n of [0, 1] as const) {
        const rows = tl.shifts.filter((r) => r[1] === n);
        const skaters = (n === 0 ? box.home : box.away).skaters;
        // Ice time: summed from the shifts it is the box's (a tenth of a minute against a second).
        const seconds = new Map<number, number>();
        rows.forEach(([from, , unit], i) => {
          const to = rows[i + 1]?.[0] ?? end;
          for (const k of unit) seconds.set(k, (seconds.get(k) ?? 0) + to - from);
        });
        skaters.forEach((line, k) =>
          expect(Math.abs((seconds.get(k) ?? 0) / 60 - line.toi)).toBeLessThan(0.15),
        );
        // Plus-minus: a goal not on the power play is one for or against everyone on the ice. A
        // change in the goal's own second can be before or after it: a game where that leaves
        // the number on the ice in doubt is not counted.
        const sizes = box.shots
          .filter((shot) => shot[5] === 1 && shot[8] === 0)
          .map(([at, side]) => {
            // The unit out before that second, and any sent out during it.
            const out = rows.filter(
              (r, i) => r[0] === at || (r[0] < at && (rows[i + 1]?.[0] ?? at) >= at),
            );
            return out.every((r) => r[2].length === out[0]![2].length)
              ? (side === n ? 1 : -1) * out[0]![2].length
              : NaN;
          });
        const want = sizes.reduce((x, y) => x + y, 0);
        if (Number.isNaN(want)) continue;
        expect(skaters.reduce((x, line) => x + line.plusMinus, 0)).toBe(want);
        counted += sizes.length;
      }
      // Second by second, once every change of that second is made, in a game nobody leaves hurt
      // (a spare is from another line): with five skaters a side, the named line is out exactly
      // when their first line is. Four-on-four is not matched: there it also meets his other lines.
      if (tl.hurt.length) continue;
      const on: [number[], number[]] = [[], []];
      tl.shifts.forEach(([at, n, unit], i) => {
        on[n] = unit;
        if (tl.shifts[i + 1]?.[0] === at) return;
        const top = on[1].some((k) => lineOf(1)[k] === 0);
        const out = on[0].some((k) => lineOf(0)[k] === named - 1);
        if (on.every((u) => u.length === 4) && top && !out) unmatched++;
        if (on.some((u) => u.length !== 5)) return;
        expect(out).toBe(top);
        if (top) answered++;
      });
    }
    expect(answered).toBeGreaterThan(5000);
    expect(unmatched).toBeGreaterThan(50);
    expect(counted).toBeGreaterThan(2000);
  });
});

/** A hot-seat league: both teams of opening night's first game are human, every other team is not. */
const league = createLeague(62, ctx);
const local: Actor = { id: 'local', controls: [] };
const opener = league.schedule
  .filter((g) => g.date.season === league.date.season)
  .sort((x, y) => x.date.day - y.date.day)[0]!;
const id = opener.id as GameId;
const [h, v] = [opener.homeTeamId, opener.awayTeamId];
const ai = (Object.keys(league.teams) as TeamId[]).find((t) => t !== h && t !== v)!;
for (const teamId of [h, v, ...(Object.keys(league.teams) as TeamId[])]) {
  const userControlled = teamId === h || teamId === v;
  handleCommand(league, { kind: 'team.setUserControlled', teamId, userControlled }, local, ctx);
}
const order = (
  teamId: TeamId,
  at: number,
  name: string,
  gameId = id,
  actor = local,
  value?: number,
) =>
  handleCommand(
    league,
    { kind: 'bench.order', gameId, teamId, at, order: name, ...(value !== undefined && { value }) },
    actor,
    ctx,
  );
const code = (r: CommandResult) => (r.ok ? 'ok' : r.error.code);

describe('bench orders in a league', () => {
  it('are refused for an AI team, a game not played today, an unknown order or a broken second', () => {
    expect(code(order(h, 600, 'emptyNet'))).toBe('invalid'); // camp: nobody plays today
    handleCommand(
      league,
      { kind: 'sim.advance', days: opener.date.day - league.date.day },
      local,
      ctx,
    );
    expect(league.date.day).toBe(opener.date.day);
    expect(code(order(ai, 600, 'emptyNet'))).toBe('not_allowed');
    // A remote GM orders his own bench only.
    expect(code(order(h, 600, 'emptyNet', id, { id: 'remote', controls: [v] }))).toBe(
      'not_allowed',
    );
    const later = league.schedule.find(
      (g) => g.id !== id && (g.homeTeamId === h || g.awayTeamId === h),
    )!;
    expect(code(order(h, 600, 'emptyNet', later.id as GameId))).toBe('invalid');
    expect(code(order(h, 600, 'timeout'))).toBe('invalid');
    expect(code(order(h, 600.5, 'emptyNet'))).toBe('invalid');
    const valued = { kind: 'bench.order', gameId: id, teamId: h, at: 600, order: 'emptyNet' };
    expect(code(handleCommand(league, { ...valued, value: 1 } as never, local, ctx))).toBe(
      'invalid',
    );
    // Matching a line is the home side's, and names a line (0 calls it off).
    expect(code(order(v, 600, 'match', id, local, 2))).toBe('invalid');
    for (const value of [undefined, -1, 1.5, MATCH_LINES + 1]) {
      expect(code(order(h, 600, 'match', id, local, value))).toBe('invalid');
    }
    expect(league.bench).toEqual({});
  });

  it('two human teams in one game both order; a copy replaying the events is identical; the day plays the coached game', () => {
    const replica = structuredClone(league);
    const plain = watchGame(league, ctx, h)!;
    expect(plain.id).toBe(id);
    const given = [
      order(h, 900, 'goalieChange'),
      order(v, 1500, 'emptyNet'),
      order(h, 1500, 'goalieBack'),
      order(h, 1500, 'match', id, local, 3),
    ].flatMap((r) => (r.ok ? r.events : []));
    expect(given).toHaveLength(4);
    // Not before an earlier order, whoever gave it.
    expect(code(order(v, 1499, 'goalieBack'))).toBe('invalid');
    expect(league.bench).toEqual({
      [id]: [
        { teamId: h, at: 900, order: 'goalieChange' },
        { teamId: v, at: 1500, order: 'emptyNet' },
        { teamId: h, at: 1500, order: 'goalieBack' },
        { teamId: h, at: 1500, order: 'match', value: 3 },
      ],
    });

    // Either GM sees the same coached game: the first order's goalie is in, the game before it is as it was.
    const coached = watchGame(league, ctx, v)!;
    expect(coached).toEqual(watchGame(league, ctx, h));
    const { timeline, ...box } = boxOf(coached);
    expect(box.home.relief).toBeDefined();
    expect(timeline!.goalies.some((r) => r[1] === 0 && r[2] === 2 && r[0] <= 900)).toBe(true);
    expect(box.shots.filter((s) => s[0] < 900)).toEqual(
      boxOf(plain).shots.filter((s) => s[0] < 900),
    );
    expect(box.shots).not.toEqual(boxOf(plain).shots);

    const day = handleCommand(league, { kind: 'sim.advance', days: 1 }, local, ctx);
    if (!day.ok) throw new Error(day.error.message);
    expect(league.results[id]).toEqual({ ...coached, box });
    expect(league.bench).toEqual({}); // dropped with the game
    for (const e of [...given, ...day.events]) applyEvent(replica, e);
    expect(replica).toEqual(league);
    expect(code(order(h, 2000, 'emptyNet'))).toBe('invalid'); // played: nothing left to coach
  });
});
