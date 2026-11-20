import { describe, expect, it } from 'vitest';
import { BENCH_ORDERS } from '@gm/shared';
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
      const orders: BenchOrder[] = Array.from({ length: dice.int(1, 3) }, () => ({
        teamId: dice.chance(0.5) ? a! : b!,
        at: dice.int(0, 3700),
        order: dice.pick(BENCH_ORDERS),
      })).sort((x, y) => x.at - y.at);
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
const order = (teamId: TeamId, at: number, name: string, gameId = id, actor = local) =>
  handleCommand(league, { kind: 'bench.order', gameId, teamId, at, order: name }, actor, ctx);
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
    ].flatMap((r) => (r.ok ? r.events : []));
    expect(given).toHaveLength(3);
    // Not before an earlier order, whoever gave it.
    expect(code(order(v, 1499, 'goalieBack'))).toBe('invalid');
    expect(league.bench).toEqual({
      [id]: [
        { teamId: h, at: 900, order: 'goalieChange' },
        { teamId: v, at: 1500, order: 'emptyNet' },
        { teamId: h, at: 1500, order: 'goalieBack' },
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
