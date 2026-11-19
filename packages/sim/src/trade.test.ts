import { describe, expect, it } from 'vitest';
import type { Actor, LeagueEvent, Player, PlayerId, TeamId } from '@gm/shared';
import {
  aiTrades,
  applyEvent,
  emitter,
  Rng,
  createLeague,
  defaultContext,
  evaluateTrade,
  handleCommand,
  inDeadlineWeek,
  pickValue,
  surplusValuator,
  type PlayerValuator,
  type LeagueState,
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

  it("does not auto-accept for another human's team", () => {
    const { state, mine, partner, myC, theirC } = setup();
    state.teams[partner]!.userControlled = true;
    const remote: Actor = { id: 'remote', controls: [mine] };
    const proposal = { fromTeamId: mine, toTeamId: partner, give: [myC[0]!], get: [theirC[0]!] };
    const res = handleCommand(state, { kind: 'trade.propose', proposal }, remote, base);
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

  it('prices a top-six rental at the deadline near a late first for a contender, under a 2nd for a seller', () => {
    // A top-six forward in a generated league is about 70 overall; $3M is a typical cap hit.
    const rental = player({
      birthYear: 2027 - 29,
      ratings: { a: 70, b: 70 },
      contract: { capHit: 3 * M, expiresAfterSeason: 2027 },
    });
    const cal = rules.season.calendar;
    const left = 1 - cal.tradeDeadlineDay / cal.regularSeasonDays;
    const v = (status: TeamContext['status']) =>
      surplusValuator.value(rental, team(status, left), rules).surplus;
    const pick = (slot: number, round: number, status: TeamContext['status']) =>
      pickValue(rules, { slot, teams: 16, round, yearsAway: 0 }, status);
    // A contender pays a late first for him, not a mid first (the playoff run is what it buys).
    expect(v('contender')).toBeGreaterThan(pick(16, 1, 'contender'));
    expect(v('contender')).toBeLessThan(pick(8, 1, 'contender'));
    // To a seller he is worth less than a mid second.
    expect(v('seller')).toBeLessThan(pick(8, 2, 'seller'));
  });

  it('counts an extension he signed: not a rental, and the new cap hit is what he costs', () => {
    const contract = { capHit: 3 * M, expiresAfterSeason: 2027 };
    const rental = player({ birthYear: 2027 - 30, ratings: { a: 72, b: 72 }, contract });
    const cheap = { ...rental, extension: { capHit: 3 * M, expiresAfterSeason: 2030 } };
    const dear = { ...rental, extension: { capHit: 11 * M, expiresAfterSeason: 2030 } };
    const v = (p: Player) => surplusValuator.value(p, team('contender', 0.5), rules);
    expect(v(cheap).reasons).not.toContain('rental');
    expect(v(cheap).surplus).toBeGreaterThan(v(rental).surplus);
    expect(v(dear).surplus).toBeLessThan(v(cheap).surplus);
  });
});

describe('AI-to-AI trades', () => {
  // Same seed, same trades: covered by the season determinism checks (sim.test, offseason.test).
  it('happen during the season, never with a human team', () => {
    const run = (seed: number) => {
      const state = createLeague(seed, base);
      // Trades end at the deadline, so the season after it is not needed.
      const days = base.ruleset.season.calendar.tradeDeadlineDay + 5;
      const res = handleCommand(state, { kind: 'sim.advance', days }, local, base);
      if (!res.ok) throw new Error(res.error.message);
      return { state, trades: res.events.filter((e) => e.kind === 'trade.completed') };
    };
    const seasons = [2, 4].map(run);
    expect(seasons.reduce((n, s) => n + s.trades.length, 0)).toBeGreaterThan(3);
    // Some buyers pay with draft picks.
    expect(
      seasons.some((s) =>
        s.trades.some((e) => e.kind === 'trade.completed' && e.givePicks?.length),
      ),
    ).toBe(true);
    for (const { state, trades } of seasons) {
      for (const e of trades) {
        if (e.kind !== 'trade.completed') continue;
        expect(state.teams[e.fromTeamId]!.userControlled).toBe(false);
        expect(state.teams[e.toTeamId]!.userControlled).toBe(false);
        expect(e.date.day).toBeLessThanOrEqual(base.ruleset.season.calendar.tradeDeadlineDay);
      }
    }
  }, 60_000);

  it('make deadline week a market: daily talks, offers gone at the deadline, a recap', () => {
    const cal = base.ruleset.season.calendar;
    const runs = [2, 4].map((seed) => {
      const state = createLeague(seed, base);
      const res = handleCommand(
        state,
        { kind: 'sim.advance', days: cal.tradeDeadlineDay + 2 - state.date.day },
        local,
        base,
      );
      if (!res.ok) throw new Error(res.error.message);
      return { state, events: res.events };
    });
    // Trades on deadline-week days that are not the weekly pulse's.
    const daily = runs.flatMap(({ events }) =>
      events.filter(
        (e) =>
          e.kind === 'trade.completed' && inDeadlineWeek(cal, e.date.day) && e.date.day % 7 !== 6,
      ),
    );
    expect(daily.length).toBeGreaterThan(0);
    for (const { state, events } of runs) {
      expect(state.tradeOffers).toEqual([]);
      for (const e of events) {
        if (e.kind === 'trade.offered')
          expect(e.offer.expiresDay).toBeLessThanOrEqual(cal.tradeDeadlineDay);
      }
      const recap = events.filter(
        (e) => e.kind === 'news.posted' && e.headline.startsWith('event.deadline'),
      );
      expect(recap.map((e) => e.date.day)).toEqual([cal.tradeDeadlineDay]);
      const week = state.seasonTrades.filter((t) => inDeadlineWeek(cal, t.day)).length;
      expect(recap[0]).toMatchObject({ params: { n: week } });
    }
  }, 60_000);

  it('a player on an AI seller’s block goes to an AI buyer more often than when unlisted', () => {
    const league = createLeague(5, base);
    const ai = Object.values(league.teams).filter((t) => !t.userControlled);
    const seller = ai[0]!.id;
    league.teamStatus[seller] = 'seller';
    for (const t of ai.slice(1, 6)) league.teamStatus[t.id] = 'contender';
    const player = Object.values(league.players)
      .filter((p) => p.teamId === seller && p.contract?.expiresAfterSeason === league.date.season)
      .sort((a, b) => a.id.localeCompare(b.id))[0]!;
    const traded = (listed: boolean) => {
      let n = 0;
      for (let seed = 0; seed < 20; seed++) {
        const state = structuredClone(league);
        if (listed) state.tradeBlock.push(player.id);
        const events: LeagueEvent[] = [];
        aiTrades(state, base, new Rng(seed), emitter(state, events));
        if (state.players[player.id]!.teamId !== seller) n++;
        for (const e of events) {
          if (e.kind !== 'trade.completed') continue;
          expect(state.teams[e.fromTeamId]!.userControlled).toBe(false);
          expect(state.teams[e.toTeamId]!.userControlled).toBe(false);
        }
      }
      return n;
    };
    expect(traded(true)).toBeGreaterThan(traded(false));
  }, 60_000);
});

describe('retained salary', () => {
  it('keeps part of the cap hit on your books for the rest of the deal', () => {
    const { state, mine, partner, myC } = setup();
    const ctx = stubContext({ [myC[0]!]: 10 * M });
    const p = state.players[myC[0]!]!;
    p.contract = { capHit: 4 * M, expiresAfterSeason: state.date.season + 2 };
    const proposal = {
      fromTeamId: mine,
      toTeamId: partner,
      give: [p.id],
      get: [],
      retain: [{ playerId: p.id, pct: 50 }],
    };
    const res = handleCommand(state, { kind: 'trade.propose', proposal }, local, ctx);
    if (!res.ok) throw new Error(res.error.message);
    expect(state.players[p.id]!.contract!.capHit).toBe(2 * M);
    const kept = state.capCharges.filter((c) => c.kind === 'retained' && c.teamId === mine);
    expect(kept.map((c) => c.season)).toEqual([0, 1, 2].map((i) => state.date.season + i));
    expect(kept.every((c) => c.amount === 2 * M)).toBe(true);
  });

  it('refuses too much, a fourth contract, or retaining the same contract twice', () => {
    const { state, mine, partner, myC } = setup();
    const ctx = stubContext(Object.fromEntries(myC.map((id) => [id, 10 * M])));
    const offer = (id: string, pct: number) =>
      evaluateTrade(state, ctx, {
        fromTeamId: mine,
        toTeamId: partner,
        give: [id as PlayerId],
        get: [],
        retain: [{ playerId: id as PlayerId, pct }],
      }).reasons[0]!.code;
    for (const id of myC) {
      state.players[id]!.contract = { capHit: 2 * M, expiresAfterSeason: state.date.season + 1 };
    }
    expect(offer(myC[0]!, 60)).toBe('retention');
    expect(offer(myC[0]!, 50)).toBe('accepted');
    // Three contracts already retained on: no fourth.
    const charge = (playerId: string) => ({
      teamId: mine,
      playerId: playerId as PlayerId,
      kind: 'retained' as const,
      season: state.date.season,
      amount: M,
    });
    state.capCharges.push(charge('x1'), charge('x2'), charge('x3'));
    expect(offer(myC[0]!, 20)).toBe('retention');
    state.capCharges = [{ ...charge(myC[1]!), teamId: partner }];
    expect(offer(myC[1]!, 20)).toBe('retention');
    expect(offer(myC[0]!, 20)).toBe('accepted');
    // The same player twice would retain 100%.
    const twice = evaluateTrade(state, ctx, {
      fromTeamId: mine,
      toTeamId: partner,
      give: [myC[0]!],
      get: [],
      retain: [
        { playerId: myC[0]!, pct: 50 },
        { playerId: myC[0]!, pct: 50 },
      ],
    });
    expect(twice.reasons[0]!.code).toBe('retention');
  });
});

describe('AI offers to you', () => {
  const findOffer = () => {
    for (const seed of [11, 12, 13, 14, 15]) {
      const state = createLeague(seed, base);
      for (let d = 0; d < base.ruleset.season.calendar.tradeDeadlineDay; d += 7) {
        const res = handleCommand(state, { kind: 'sim.advance', days: 7 }, local, base);
        if (!res.ok) throw new Error(res.error.message);
        if (state.tradeOffers.length) return state;
      }
    }
    throw new Error('no offer in five leagues');
  };
  // Searched once; each test gets its own copy.
  let found: LeagueState | undefined;
  const seasonWithOffer = () => structuredClone((found ??= findOffer()));

  it('arrive, can be accepted, and the trade goes through', () => {
    const state = seasonWithOffer();
    const offer = state.tradeOffers[0]!;
    const mine = offer.proposal.toTeamId;
    expect(state.teams[mine]!.userControlled).toBe(true);
    expect(state.teams[offer.proposal.fromTeamId]!.userControlled).toBe(false);
    const res = handleCommand(
      state,
      { kind: 'trade.respond', offerId: offer.id, accept: true },
      local,
      base,
    );
    if (!res.ok) throw new Error(res.error.message);
    expect(state.players[offer.proposal.give[0]!]!.teamId).toBe(mine);
    expect(state.players[offer.proposal.get[0]!]!.teamId).toBe(offer.proposal.fromTeamId);
    expect(state.tradeOffers).toEqual([]);
  });

  it('can be declined, and expire after a week', () => {
    const state = seasonWithOffer();
    const copy = structuredClone(state);
    const offer = state.tradeOffers[0]!;
    const res = handleCommand(
      state,
      { kind: 'trade.respond', offerId: offer.id, accept: false },
      local,
      base,
    );
    expect(res.ok).toBe(true);
    expect(state.tradeOffers).toEqual([]);
    // Left alone, it is gone after its last day.
    handleCommand(copy, { kind: 'sim.advance', days: 9 }, local, base);
    expect(copy.tradeOffers.some((o) => o.id === offer.id)).toBe(false);
  });
});
