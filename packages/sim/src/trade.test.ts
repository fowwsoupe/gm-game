import { describe, expect, it } from 'vitest';
import type { Actor, Player, PlayerId, TeamId } from '@gm/shared';
import {
  applyEvent,
  createLeague,
  defaultContext,
  evaluateTrade,
  handleCommand,
  surplusValuator,
  type PlayerValuator,
  type TeamContext,
} from './index';

const local: Actor = { id: 'local', controls: [] };
const base = defaultContext();

/** Surplus by player id, so each case is exact. Everyone else is worth 0. */
function stubContext(values: Record<string, number>) {
  const valuation: PlayerValuator = {
    value: (p) => ({
      surplus: values[p.id] ?? 0,
      reasons: values[p.id]! < 0 ? ['negative_contract'] : [],
    }),
  };
  return defaultContext(base.ruleset.id, { models: { valuation } });
}

/** A league with the user's team and one AI partner, every contract cheap so the cap never interferes. */
function setup() {
  const state = createLeague(5, base);
  const teams = Object.values(state.teams);
  const mine = teams.find((t) => t.userControlled)!.id;
  const partner = teams.find((t) => !t.userControlled)!.id;
  for (const p of Object.values(state.players)) {
    if (p.contract) p.contract = { ...p.contract, capHit: base.ruleset.cap.minSalary };
  }
  const skaters = (teamId: TeamId) =>
    Object.values(state.players)
      .filter((p) => p.teamId === teamId && p.position === 'C')
      .map((p) => p.id);
  return { state, mine, partner, myC: skaters(mine), theirC: skaters(partner) };
}

const M = 1_000_000;

describe('trade evaluation', () => {
  it('accepts a clear win for the other team and moves the players', () => {
    const { state, mine, partner, myC, theirC } = setup();
    const ctx = stubContext({ [myC[0]!]: 10 * M });
    const proposal = { fromTeamId: mine, toTeamId: partner, give: [myC[0]!], get: [theirC[0]!] };
    expect(evaluateTrade(state, ctx, proposal).accepted).toBe(true);

    const copy = structuredClone(state);
    const res = handleCommand(state, { kind: 'trade.propose', proposal }, local, ctx);
    if (!res.ok) throw new Error(res.error.message);
    expect(state.players[myC[0]!]!.teamId).toBe(partner);
    expect(state.players[theirC[0]!]!.teamId).toBe(mine);
    for (const e of res.events) applyEvent(copy, e);
    expect(copy).toEqual(state);
  });

  it('refuses to give a star for nothing', () => {
    const { state, mine, partner, myC, theirC } = setup();
    const ctx = stubContext({ [theirC[0]!]: 10 * M });
    const verdict = evaluateTrade(state, ctx, {
      fromTeamId: mine,
      toTeamId: partner,
      give: [myC[0]!],
      get: [theirC[0]!],
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons[0]!.code).toBe('value_short');
  });

  it('does not sell a star for three average players', () => {
    const { state, mine, partner, myC, theirC } = setup();
    // Raw sum 12 beats 10, but depth discounts make it 4 + 2.7 + 2 = 8.7.
    const ctx = stubContext({
      [theirC[0]!]: 10 * M,
      [myC[0]!]: 4 * M,
      [myC[1]!]: 4 * M,
      [myC[2]!]: 4 * M,
    });
    const verdict = evaluateTrade(state, ctx, {
      fromTeamId: mine,
      toTeamId: partner,
      give: myC.slice(0, 3),
      get: [theirC[0]!],
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons.map((r) => r.code)).toContain('quantity');
  });

  it('will not take a bad contract for free', () => {
    const { state, mine, partner, myC } = setup();
    const ctx = stubContext({ [myC[0]!]: -5 * M });
    const verdict = evaluateTrade(state, ctx, {
      fromTeamId: mine,
      toTeamId: partner,
      give: [myC[0]!],
      get: [],
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons.map((r) => r.code)).toContain('bad_contract');
  });

  it('is closed after the trade deadline and refuses players from the wrong team', () => {
    const { state, mine, partner, myC, theirC } = setup();
    const ctx = stubContext({ [myC[0]!]: 10 * M });
    const swap = { fromTeamId: mine, toTeamId: partner, give: [myC[0]!], get: [theirC[0]!] };
    expect(evaluateTrade(state, ctx, { ...swap, give: [theirC[1]!] }).reasons[0]!.code).toBe(
      'not_on_team',
    );
    state.date = { ...state.date, day: ctx.ruleset.season.calendar.tradeDeadlineDay + 1 };
    expect(evaluateTrade(state, ctx, swap).reasons[0]!.code).toBe('closed');
  });

  it('refuses a trade that leaves the other team short at a position', () => {
    const { state, mine, partner } = setup();
    const goalies = Object.values(state.players)
      .filter((p) => p.teamId === partner && p.position === 'G')
      .map((p) => p.id);
    const ctx = stubContext({});
    const verdict = evaluateTrade(state, ctx, {
      fromTeamId: mine,
      toTeamId: partner,
      give: [],
      get: goalies,
    });
    expect(verdict.reasons[0]).toEqual({ code: 'short_at', params: { position: 'G' } });
  });

  it('only lets you trade your own team', () => {
    const { state, partner, theirC } = setup();
    const other = Object.values(state.teams).find((t) => !t.userControlled && t.id !== partner)!;
    const res = handleCommand(
      state,
      {
        kind: 'trade.propose',
        proposal: { fromTeamId: partner, toTeamId: other.id, give: [theirC[0]!], get: [] },
      },
      local,
      base,
    );
    expect(res.ok).toBe(false);
  });
});

describe('trades with the default valuation', () => {
  it('refuses your worst player for its best one', () => {
    const state = createLeague(9, base);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const partner = Object.values(state.teams).find((t) => !t.userControlled)!.id;
    const rated = (teamId: TeamId) =>
      Object.values(state.players)
        .filter((p) => p.teamId === teamId && p.position === 'C')
        .sort((a, b) => b.potential - a.potential);
    const verdict = evaluateTrade(state, base, {
      fromTeamId: mine,
      toTeamId: partner,
      give: [rated(mine).at(-1)!.id],
      get: [rated(partner)[0]!.id],
    });
    expect(verdict.accepted).toBe(false);
  });
});

describe('surplus value', () => {
  const rules = base.ruleset;
  const team = (status: TeamContext['status'], seasonLeft = 1): TeamContext => ({
    status,
    season: 2027,
    seasonLeft,
    capSpace: 0,
    needs: [],
  });
  const player = (over: Partial<Player>): Player => ({
    id: 'x' as PlayerId,
    firstName: 'A',
    lastName: 'B',
    birthYear: 1997,
    teamId: null,
    position: 'C',
    potential: 60,
    ratings: { a: 60, b: 60 },
    ...over,
  });

  it('is negative for an expensive fading veteran and positive for a cheap young one', () => {
    const vet = player({
      birthYear: 2027 - 34,
      ratings: { a: 58, b: 58 },
      contract: { capHit: 9 * M, expiresAfterSeason: 2030 },
    });
    const kid = player({
      birthYear: 2027 - 20,
      potential: 78,
      ratings: { a: 62, b: 62 },
      contract: { capHit: M, expiresAfterSeason: 2028 },
    });
    expect(surplusValuator.value(vet, team('bubble'), rules).surplus).toBeLessThan(0);
    expect(surplusValuator.value(vet, team('bubble'), rules).reasons).toContain(
      'negative_contract',
    );
    const young = surplusValuator.value(kid, team('bubble'), rules);
    expect(young.surplus).toBeGreaterThan(0);
    expect(young.reasons).toContain('prospect');
  });

  it('prices a rental higher for a contender, and lower as the season runs out', () => {
    const rental = player({
      birthYear: 2027 - 30,
      ratings: { a: 72, b: 72 },
      contract: { capHit: 3 * M, expiresAfterSeason: 2027 },
    });
    const v = (t: TeamContext) => surplusValuator.value(rental, t, rules).surplus;
    expect(v(team('contender', 0.5))).toBeGreaterThan(v(team('rebuilder', 0.5)));
    expect(v(team('contender', 0.2))).toBeLessThan(v(team('contender', 0.8)));
    expect(surplusValuator.value(rental, team('contender', 0.5), rules).reasons).toContain(
      'rental',
    );
  });
});
