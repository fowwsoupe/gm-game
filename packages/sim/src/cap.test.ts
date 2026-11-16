import { describe, expect, it } from 'vitest';
import type { Actor, Player, PlayerId, TeamId } from '@gm/shared';
import {
  applyEvent,
  buyoutCharges,
  capIssues,
  capSheet,
  createLeague,
  defaultContext,
  handleCommand,
  NHL_2026,
  retentionIssues,
  validateContract,
  type LeagueState,
} from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };
const rules = NHL_2026; // upper $104M, floor $76.9M, 10% offseason overage, max hit $20.8M

const player = (id: string, teamId: string | null, capHit: number, expires: number, born = 1997) =>
  ({
    id: id as PlayerId,
    teamId: teamId as TeamId | null,
    firstName: id,
    lastName: id,
    birthYear: born,
    position: 'C',
    potential: 60,
    ratings: {},
    contract: { capHit, expiresAfterSeason: expires },
  }) satisfies Player;

describe('cap compliance', () => {
  it('allows 10% over in the offseason only, and checks the floor during the season', () => {
    expect(capIssues(rules, 114_400_000, 'offseason')).toEqual([]); // 104M + 10.4M exactly
    expect(capIssues(rules, 114_400_001, 'offseason')).toEqual([
      { code: 'over_offseason_limit', over: 1 },
    ]);
    expect(capIssues(rules, 104_000_001, 'regular')).toEqual([{ code: 'over_cap', over: 1 }]);
    expect(capIssues(rules, 70_000_000, 'regular')).toEqual([
      { code: 'below_floor', short: 6_900_000 },
    ]);
    expect(capIssues(rules, 70_000_000, 'offseason')).toEqual([]);
    expect(capIssues(rules, 10_000_000, 'future')).toEqual([]); // future floors are not checked
  });
});

describe('buyouts', () => {
  it('owes 2/3 of the rest at 26+, spread over twice the remaining seasons', () => {
    // Bought out after 2027 at age 30 (born 1997) with two seasons left at $4M:
    // owed = 2/3 x $4M x 2 = $5,333,333; four seasons of $1,333,333, the last one $1 more.
    const charges = buyoutCharges(rules, {
      teamId: 't1' as TeamId,
      player: player('e', 't1', 4_000_000, 2029),
      season: 2027,
    });
    expect(charges.map((c) => [c.season, c.amount])).toEqual([
      [2028, 1_333_333],
      [2029, 1_333_333],
      [2030, 1_333_333],
      [2031, 1_333_334],
    ]);
  });

  it('owes 1/3 under 26, and nothing for a contract that ends this season', () => {
    // Age 23, one season left at $3M: owed $1M over two seasons.
    const young = buyoutCharges(rules, {
      teamId: 't1' as TeamId,
      player: player('y', 't1', 3_000_000, 2028, 2004),
      season: 2027,
    });
    expect(young.map((c) => c.amount)).toEqual([500_000, 500_000]);
    expect(
      buyoutCharges(rules, {
        teamId: 't1' as TeamId,
        player: player('z', 't1', 3_000_000, 2027),
        season: 2027,
      }),
    ).toEqual([]);
  });
});

describe('cap sheet', () => {
  it('matches a hand-checked example', () => {
    const players = [
      player('a', 't1', 10_000_000, 2029),
      player('b', 't1', 5_000_000, 2028),
      player('c', 't1', 1_000_000, 2027), // expires before the sheet starts
      player('d', 't2', 9_000_000, 2030), // another team
    ];
    const charges = buyoutCharges(rules, {
      teamId: 't1' as TeamId,
      player: player('e', 't1', 4_000_000, 2029),
      season: 2027,
    });
    const sheet = capSheet(rules, {
      teamId: 't1' as TeamId,
      players,
      charges,
      fromSeason: 2028,
      years: 3,
      phase: 'offseason',
    });
    const rows = sheet.seasons.map((s) => [
      s.season,
      s.contracts.map((c) => c.playerId),
      s.committed,
      s.deadCap,
      s.total,
      s.space,
      s.issues,
    ]);
    expect(rows).toEqual([
      // 10M + 5M, plus $1,333,333 dead cap. Below the floor, but that is legal in the offseason.
      [2028, ['a', 'b'], 15_000_000, 1_333_333, 16_333_333, 87_666_667, []],
      [2029, ['a'], 10_000_000, 1_333_333, 11_333_333, 92_666_667, []],
      [2030, [], 0, 1_333_333, 1_333_333, 102_666_667, []],
    ]);
  });
});

describe('contract rules', () => {
  it('checks entry-level length by signing age and the entry-level salary cap', () => {
    const elc = (age: number, salaries: number[]) =>
      validateContract(rules, { salaries, signingAge: age, isResign: false, elc: true });
    expect(elc(19, [1_000_000, 1_000_000, 1_000_000])).toEqual([]);
    expect(elc(19, [1_000_000, 1_000_000])).toEqual([{ code: 'elc_length', years: 3 }]);
    expect(elc(22, [1_200_000, 1_200_000])).toEqual([{ code: 'elc_salary', max: 1_000_000 }]);
    expect(elc(26, [900_000])).toEqual([{ code: 'elc_age', age: 26 }]);
  });

  it('limits retention to 50%, three contracts, and no double retention within 75 days', () => {
    const check = (retainPct: number, count: number, days: number | null) =>
      retentionIssues(rules, { retainPct, teamRetainedCount: count, daysSinceRetained: days });
    expect(check(50, 2, null)).toEqual([]);
    expect(check(51, 2, null)).toEqual([{ code: 'retention_too_high', max: 50 }]);
    expect(check(25, 3, null)).toEqual([{ code: 'too_many_retained', max: 3 }]);
    expect(check(25, 0, 74)).toEqual([{ code: 'retained_too_recently', days: 75 }]);
    expect(check(25, 0, 75)).toEqual([]);
  });

  it('every contract in a generated league is legal', () => {
    const state = createLeague(3, ctx);
    for (const p of Object.values(state.players)) {
      const c = p.contract!;
      const seasons = c.expiresAfterSeason - state.date.season + 1;
      const issues = validateContract(ctx.ruleset, {
        salaries: Array<number>(seasons).fill(c.capHit),
        signingAge: state.date.season - p.birthYear,
        isResign: true,
      });
      expect(issues).toEqual([]);
    }
  });
});

describe('buyout command', () => {
  const finishedSeason = (seed: number): LeagueState => {
    const state = createLeague(seed, ctx);
    const res = handleCommand(state, { kind: 'sim.advance', days: 260 }, local, ctx);
    if (!res.ok || !state.championTeamId) throw new Error('season did not finish');
    return state;
  };
  const longDeal = (state: LeagueState, userTeam: boolean) =>
    Object.values(state.players).find(
      (p) =>
        p.teamId &&
        state.teams[p.teamId]!.userControlled === userTeam &&
        p.contract!.expiresAfterSeason > state.date.season,
    )!;

  it('frees the player and books dead cap that the next season keeps', () => {
    const state = finishedSeason(5);
    const replica: LeagueState = structuredClone(state);
    const target = longDeal(state, true);
    const teamId = target.teamId!;
    const res = handleCommand(state, { kind: 'contract.buyout', playerId: target.id }, local, ctx);
    if (!res.ok) throw new Error(res.error.message);
    expect(state.players[target.id]!.teamId).toBeNull();
    expect(state.players[target.id]!.contract).toBeUndefined();
    expect(state.capCharges.length).toBeGreaterThan(0);
    expect(state.capCharges.every((c) => c.teamId === teamId)).toBe(true);
    for (const e of res.events) applyEvent(replica, e);
    expect(replica).toEqual(state);

    const rolled = handleCommand(state, { kind: 'season.rollover' }, local, ctx);
    if (!rolled.ok) throw new Error(rolled.error.message);
    // The first charge is for the season that just started, so nothing has been dropped yet.
    expect(state.capCharges[0]!.season).toBe(state.date.season);
    const sheet = capSheet(ctx.ruleset, {
      teamId,
      players: Object.values(state.players),
      charges: state.capCharges,
      fromSeason: state.date.season,
      years: 1,
      phase: 'regular',
    });
    expect(sheet.seasons[0]!.deadCap).toBe(state.capCharges[0]!.amount);
  });

  it('refuses during the season, for another team, and for an expiring deal', () => {
    const live = createLeague(6, ctx);
    const mine = longDeal(live, true);
    expect(
      handleCommand(live, { kind: 'contract.buyout', playerId: mine.id }, local, ctx),
    ).toMatchObject({ ok: false, error: { code: 'invalid' } });

    const state = finishedSeason(6);
    const theirs = longDeal(state, false);
    expect(
      handleCommand(state, { kind: 'contract.buyout', playerId: theirs.id }, local, ctx),
    ).toMatchObject({ ok: false, error: { code: 'not_allowed' } });
    const expiring = Object.values(state.players).find(
      (p) =>
        p.teamId &&
        state.teams[p.teamId]!.userControlled &&
        p.contract!.expiresAfterSeason === state.date.season,
    );
    if (expiring) {
      expect(
        handleCommand(state, { kind: 'contract.buyout', playerId: expiring.id }, local, ctx),
      ).toMatchObject({ ok: false, error: { code: 'invalid' } });
    }
  });
});
