import { describe, expect, it } from 'vitest';
import type { Actor, Command, LeagueEvent, Player, TeamId } from '@gm/shared';
import {
  applyEvent,
  counterSalary,
  createLeague,
  defaultContext,
  disputesWeek,
  emitter,
  handleCommand,
  lineOf,
  overall,
  personalityOf,
  playerProfiles,
  PROMISE_DAYS,
  resignOffers,
  Rng,
  roomFor,
  seenBy,
  signFreeAgent,
  signingInterest,
  stayChance,
  talksLeft,
  walkAway,
  type LeagueState,
} from './index';

const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

/** A league whose season and playoffs are done. */
function finishedSeason(seed: number) {
  const state = createLeague(seed, ctx);
  run(state, { kind: 'sim.advance', days: 300 });
  if (!state.championTeamId) throw new Error('no champion');
  const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
  return { state, mine };
}

const freeAgents = (state: LeagueState) =>
  Object.values(state.players).filter((p) => p.teamId === null);

const sign = (p: Player, teamId: TeamId, salary: number, years: number): Command => ({
  kind: 'contract.sign',
  playerId: p.id,
  teamId,
  salary,
  years,
});

describe('free agency', () => {
  it('splitting the summer gives the same league as one rollover', () => {
    const a = finishedSeason(21).state;
    const b = structuredClone(a);
    const whole = run(a, { kind: 'season.rollover' });
    const halves = [
      ...run(b, { kind: 'offseason.openFreeAgency' }),
      ...run(b, { kind: 'season.rollover' }),
    ];
    expect(halves).toEqual(whole);
    expect(b).toEqual(a);
    expect(a.freeAgencyOpen).toBe(false);
  });

  it('opens once, then lets you sign an interested free agent', () => {
    const { state, mine } = finishedSeason(22);
    run(state, { kind: 'offseason.openFreeAgency' });
    expect(state.freeAgencyOpen).toBe(true);
    expect(handleCommand(state, { kind: 'offseason.openFreeAgency' }, local, ctx).ok).toBe(false);

    state.teamStatus[mine] = 'contender';
    const target = freeAgents(state).sort((x, y) => x.birthYear - y.birthYear)[0]!;
    const view = signingInterest(state, ctx, target, mine, { salary: 0, years: 1 });
    const salary = Math.round(view.ask * 1.2);
    expect(
      signingInterest(state, ctx, target, mine, { salary, years: 5 }).interest,
    ).toBeGreaterThanOrEqual(lineOf(ctx, target.id));
    const [ev] = run(state, sign(target, mine, salary, 2));
    expect(ev!.kind).toBe('player.signed');
    expect(state.players[target.id]!.teamId).toBe(mine);
    expect(state.players[target.id]!.contract).toEqual({
      capHit: salary,
      expiresAfterSeason: state.date.season + 2,
    });

    // The next season starts with him on the team.
    run(state, { kind: 'season.rollover' });
    expect(state.players[target.id]!.teamId).toBe(mine);
  });

  it('answers a lowball with his agent, refuses a player under contract and a team with no room', () => {
    const { state, mine } = finishedSeason(23);
    run(state, { kind: 'offseason.openFreeAgency' });
    const [target, other] = freeAgents(state) as [Player, Player];
    const { ask } = signingInterest(state, ctx, target, mine, { salary: 0, years: 1 });
    const lowball = run(state, sign(other, mine, Math.round(ask * 0.5), 1));
    expect(lowball[0]!.kind).toBe('contract.countered');
    expect(other.teamId).toBeNull();

    const rostered = Object.values(state.players).find((p) => p.teamId && p.teamId !== mine)!;
    expect(handleCommand(state, sign(rostered, mine, ask, 1), local, ctx).ok).toBe(false);

    for (const p of Object.values(state.players)) {
      if (p.teamId === mine && p.contract) p.contract.capHit = ctx.ruleset.cap.upperLimit;
    }
    const broke = handleCommand(state, sign(target, mine, ask, 1), local, ctx);
    expect(broke).toMatchObject({ ok: false, error: { message: 'no cap room' } });
  });

  it('refuses a NaN salary and a fractional re-sign term', () => {
    const { state, mine } = finishedSeason(5);
    const own = Object.values(state.players).find((p) => p.teamId === mine)!;
    own.contract = { ...own.contract!, expiresAfterSeason: state.date.season };
    delete own.extension;
    for (const [salary, years] of [
      [own.contract!.capHit, 2.5],
      [NaN, 2],
    ]) {
      const res = handleCommand(
        state,
        { kind: 'contract.resign', playerId: own.id, salary: salary!, years: years! },
        local,
        ctx,
      );
      expect(res.ok).toBe(false);
    }
    run(state, { kind: 'offseason.openFreeAgency' });
    const fa = freeAgents(state)[0]!;
    expect('error' in signFreeAgent(state, ctx, fa, mine, { salary: NaN, years: 1 })).toBe(true);
  });

  it('a veteran wants a winner more than a rebuild', () => {
    const { state, mine } = finishedSeason(24);
    const vet = Object.values(state.players).find(
      (p) => state.date.season + 1 - p.birthYear >= 33,
    )!;
    const offer = { salary: 2_000_000, years: 2 };
    state.teamStatus[mine] = 'contender';
    const contender = signingInterest(state, ctx, vet, mine, offer).interest;
    state.teamStatus[mine] = 'rebuilder';
    expect(signingInterest(state, ctx, vet, mine, offer).interest).toBeLessThan(contender);
  });

  it('closes signings during the playoffs', () => {
    const state = createLeague(25, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    state.date = { ...state.date, day: ctx.ruleset.season.calendar.regularSeasonDays + 1 };
    const target = Object.values(state.players)[0]!;
    target.teamId = null;
    const res = handleCommand(state, sign(target, mine, 5_000_000, 1), local, ctx);
    expect(res).toMatchObject({
      ok: false,
      error: { message: 'signings are closed in the playoffs' },
    });
  });

  it('closes signings after the trade deadline, except to fill a position minimum', () => {
    const state = createLeague(25, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    state.date = { ...state.date, day: ctx.ruleset.season.calendar.tradeDeadlineDay + 1 };
    const goalies = Object.values(state.players).filter(
      (p) => p.teamId === mine && p.position === 'G',
    );
    const target = Object.values(state.players).find(
      (p) => p.teamId !== mine && p.position === 'G',
    )!;
    target.teamId = null;
    const offer = { salary: 20_000_000, years: 1 };
    expect(signFreeAgent(state, ctx, target, mine, offer)).toEqual({
      error: 'signings are closed after the trade deadline',
    });
    // Down to one goalie under the minimum of two: he may sign one.
    for (const g of goalies.slice(ctx.ruleset.roster.positionMin.G! - 1)) g.teamId = null;
    expect(signFreeAgent(state, ctx, target, mine, offer)).not.toEqual({
      error: 'signings are closed after the trade deadline',
    });
  });
});

describe('AI offers in free agency', () => {
  it('rival teams make legal offers, and a contested player picks one', () => {
    const { state, mine } = finishedSeason(27);
    run(state, { kind: 'offseason.openFreeAgency' });
    expect(state.faOffers).toEqual([]);
    run(state, { kind: 'freeAgency.advanceDay' });
    expect(state.faOffers.length).toBeGreaterThan(0);
    for (const o of state.faOffers) {
      expect(state.teams[o.teamId]!.userControlled).toBe(false);
      expect(state.players[o.playerId]!.teamId).toBeNull();
      expect(signFreeAgent(state, ctx, state.players[o.playerId]!, o.teamId, o)).toHaveProperty(
        'contract',
      );
    }

    // Your offer on a contested player waits for the others instead of signing him now.
    const target = state.players[state.faOffers[0]!.playerId]!;
    const { ask } = signingInterest(state, ctx, target, mine, { salary: 0, years: 1 });
    state.teamStatus[mine] = 'contender';
    const salary = Math.round(ask * 1.5);
    const [ev] = run(state, sign(target, mine, salary, 2));
    expect(ev!.kind).toBe('freeAgency.offered');
    expect(target.teamId).toBeNull();
    // His agent tells you who is bidding, where you stand and when he decides.
    const bids = playerProfiles(state, ctx, null).find((p) => p.id === target.id)!.bids!;
    expect(bids.teams.length).toBeGreaterThan(0);
    expect(bids.mine).toBeDefined();
    expect(bids.days).toBe(ctx.ruleset.freeAgency.days);

    // He decides once the race's days are up; if it was not with you, you are told.
    const events: LeagueEvent[] = [];
    for (let day = 0; day < bids.days; day++) {
      expect(target.teamId).toBeNull();
      events.push(...run(state, { kind: 'freeAgency.advanceDay' }));
    }
    expect(target.teamId).not.toBeNull();
    expect(state.faOffers.some((o) => o.playerId === target.id)).toBe(false);
    const lost = events.some(
      (e) => e.kind === 'news.posted' && e.headline === 'event.lostFreeAgent',
    );
    expect(lost).toBe(target.teamId !== mine);
  });

  it('a full contender lets its worst depth player go for a star, nobody else does', () => {
    const { state } = finishedSeason(23);
    run(state, { kind: 'offseason.openFreeAgency' });
    const { maxActive } = ctx.ruleset.roster;
    const size = (id: TeamId) => Object.values(state.players).filter((x) => x.teamId === id).length;
    const team = Object.values(state.teams).find(
      (t) => !t.userControlled && size(t.id) <= maxActive,
    )!;
    // Fill the roster from the pool (cheap deals) and free a star from another team.
    for (const p of freeAgents(state)) {
      if (size(team.id) >= maxActive) break;
      p.teamId = team.id;
      p.contract = { capHit: ctx.ruleset.cap.minSalary, expiresAfterSeason: state.date.season + 2 };
    }
    const seen = (p: Player) => overall(seenBy(team, p));
    const star = Object.values(state.players)
      .filter((p) => p.teamId !== null && p.teamId !== team.id)
      .sort((a, b) => seen(b) - seen(a))[0]!;
    star.teamId = null;
    delete star.contract;
    const salary = ctx.ruleset.cap.minSalary;

    team.plan = { kind: 'retool', since: state.date.season };
    expect(roomFor(state, ctx, team.id, star, salary)).toBeNull();

    team.plan = { kind: 'contend', since: state.date.season };
    const room = roomFor(state, ctx, team.id, star, salary)!;
    expect(room.letGo).toHaveLength(1);
    const roster = Object.values(state.players)
      .filter((p) => p.teamId === team.id)
      .sort((a, b) => seen(b) - seen(a));
    // Outside the core, and nobody outside the core rated lower at a position he can spare.
    expect(roster.slice(0, 8)).not.toContain(room.letGo[0]);
    expect(seen(room.letGo[0]!)).toBeLessThan(seen(star));
    expect(room.freed).toBeGreaterThan(0);
    // A depth free agent is no reason to make room.
    const weak = freeAgents(state).sort((a, b) => seen(a) - seen(b))[0]!;
    expect(roomFor(state, ctx, team.id, weak, salary)).toBeNull();
  });

  it('a bidding war: he waits, the trailing team raises within its walk-away, the best interest wins', () => {
    const { state } = finishedSeason(28);
    run(state, { kind: 'offseason.openFreeAgency' });
    const ask = (p: Player) => ctx.models.contractDemand.ask(ctx.ruleset, p);
    const legal = (p: Player, teamId: TeamId, salary: number) => {
      const room = roomFor(state, ctx, teamId, p, salary);
      const deal = room && signFreeAgent(state, ctx, p, teamId, { salary, years: 3 }, room.freed);
      return !!deal && 'contract' in deal;
    };
    const ai = (Object.keys(state.teams) as TeamId[]).filter(
      (id) => !state.teams[id]!.userControlled,
    );
    // The best free agent, with offers at his ask from two AI teams that could pay up to their walk-away.
    const star = freeAgents(state).sort((a, b) => overall(b) - overall(a))[0]!;
    const bidders = ai
      .filter(
        (id) => legal(star, id, ask(star)) && legal(star, id, walkAway(state, ctx, id, ask(star))),
      )
      .slice(0, 2);
    expect(bidders).toHaveLength(2);
    // A depth player with one offer, from a third team.
    const [depth, single] = freeAgents(state)
      .sort((a, b) => overall(a) - overall(b))
      .flatMap((p) =>
        ai.filter((id) => !bidders.includes(id) && legal(p, id, ask(p))).map((id) => [p, id]),
      )[0] as [Player, TeamId];
    for (const teamId of bidders) {
      state.faOffers.push({ playerId: star.id, teamId, salary: ask(star), years: 3, since: 0 });
    }
    state.faOffers.push({ playerId: depth.id, teamId: single, salary: ask(depth), years: 3 });
    const replica = structuredClone(state);

    // Day 1: the depth player signs; the star waits and the trailing team raises.
    const day1 = run(state, { kind: 'freeAgency.advanceDay' });
    expect(depth.teamId).toBe(single);
    expect(star.teamId).toBeNull();
    const raises = day1.filter(
      (e) =>
        e.kind === 'freeAgency.offered' &&
        e.offer.playerId === star.id &&
        bidders.includes(e.offer.teamId),
    );
    expect(raises.length).toBeGreaterThan(0);
    expect(raises.every((e) => e.kind === 'freeAgency.offered' && e.raise)).toBe(true); // the room's "raises"
    for (const o of state.faOffers.filter((x) => x.playerId === star.id)) {
      expect(o.salary).toBeLessThanOrEqual(walkAway(state, ctx, o.teamId, ask(star)));
      if (bidders.includes(o.teamId)) expect(o.since).toBe(0);
    }
    const best = state.faOffers
      .filter((o) => o.playerId === star.id)
      .map((o) => ({ o, interest: signingInterest(state, ctx, star, o.teamId, o).interest }))
      .sort((a, b) => b.interest - a.interest || a.o.teamId.localeCompare(b.o.teamId))[0]!;

    // Day `freeAgency.days` after his first offer: he signs the offer he likes best.
    expect(ctx.ruleset.freeAgency.days).toBe(2);
    const day2 = run(state, { kind: 'freeAgency.advanceDay' });
    expect(state.marketDay).toBe(2);
    expect(star.teamId).toBe(best.o.teamId);
    expect(star.contract!.capHit).toBe(best.o.salary);

    // A replay of the summer's events gives the same league.
    for (const e of [...day1, ...day2]) applyEvent(replica, e);
    expect(replica).toEqual(state);
  });

  it('advancing a day needs free agency open', () => {
    const { state } = finishedSeason(28);
    expect(handleCommand(state, { kind: 'freeAgency.advanceDay' }, local, ctx).ok).toBe(false);
  });
});

describe('personality in free agency', () => {
  it('is fixed per player, and greedy players weigh money more', () => {
    expect(personalityOf('p1')).toEqual(personalityOf('p1'));
    expect(personalityOf('p1')).not.toEqual(personalityOf('p2'));
    const state = createLeague(26, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const age = (p: Player) => state.date.season - p.birthYear;
    const prime = Object.values(state.players).filter((p) => age(p) >= 26 && age(p) < 32);
    const greedy = prime.find((p) => personalityOf(p.id).greed > 0.8)!;
    const modest = prime.find((p) => personalityOf(p.id).greed < 0.2)!;
    const moneyWeight = (p: Player) =>
      signingInterest(state, ctx, p, mine, { salary: 1, years: 1 }).factors.find(
        (f) => f.key === 'money',
      )!.weight;
    expect(moneyWeight(greedy)).toBeGreaterThan(moneyWeight(modest));
  });
});

describe('negotiation', () => {
  const askOf = (p: Player) => ctx.models.contractDemand.ask(ctx.ruleset, p);
  const countered = (events: LeagueEvent[]) => {
    const ev = events[0];
    if (ev?.kind !== 'contract.countered') throw new Error(`no counter: ${ev?.kind}`);
    return ev;
  };

  it("a greedy player's line is above a modest one's, within the ruleset's swing", () => {
    const ids = Array.from({ length: 500 }, (_, i) => `p${i}`);
    const greedy = ids.find((id) => personalityOf(id).greed > 0.9)!;
    const modest = ids.find((id) => personalityOf(id).greed < 0.1)!;
    expect(lineOf(ctx, greedy)).toBeGreaterThan(lineOf(ctx, modest));
    const { line, lineSwing } = ctx.ruleset.freeAgency;
    for (const id of ids) expect(Math.abs(lineOf(ctx, id) - line)).toBeLessThanOrEqual(lineSwing);
  });

  it('an offer under his line gets a counter that signs him when sent back', () => {
    const { state, mine } = finishedSeason(22);
    run(state, { kind: 'offseason.openFreeAgency' });
    state.teamStatus[mine] = 'contender';
    const low = (p: Player) => ({ salary: Math.round(askOf(p) * 0.7), years: 2 });
    // An unrestricted free agent nobody else bids for, who turns down 70% of his ask.
    const target = freeAgents(state).find(
      (p) =>
        !state.rfaRights[p.id] &&
        talksLeft(state, ctx, p.id, mine) >= 3 &&
        low(p).salary >= ctx.ruleset.cap.minSalary &&
        signingInterest(state, ctx, p, mine, low(p)).interest < lineOf(ctx, p.id) &&
        counterSalary(state, ctx, p, mine, low(p)) !== null,
    )!;
    const before = talksLeft(state, ctx, target.id, mine);
    const reply = countered(run(state, sign(target, mine, low(target).salary, 2)));
    expect(reply.rounds).toBeLessThan(before);
    expect(talksLeft(state, ctx, target.id, mine)).toBe(reply.rounds);
    // His agent asks for more than his line: the counter clears it.
    const at = signingInterest(state, ctx, target, mine, { salary: reply.counter!, years: 2 });
    expect(at.interest).toBeGreaterThanOrEqual(lineOf(ctx, target.id));
    const [ev] = run(state, sign(target, mine, reply.counter!, 2));
    expect(ev).toMatchObject({ kind: 'player.signed', contract: { capHit: reply.counter } });
  });

  it('a calm player hears more offers than a hot head, a lowball spends two, talks reopen with free agency', () => {
    const { state, mine } = finishedSeason(22);
    run(state, { kind: 'offseason.openFreeAgency' });
    const { lowball } = ctx.ruleset.freeAgency;
    const { minSalary } = ctx.ruleset.cap;
    // An offer just under his line: the most, in steps of 1% of his ask, that he turns down.
    const justUnder = (p: Player) => {
      for (let pct = 150; pct > 0; pct--) {
        const salary = Math.round((askOf(p) * pct) / 100);
        const { interest } = signingInterest(state, ctx, p, mine, { salary, years: 2 });
        if (interest < lineOf(ctx, p.id)) return { salary, under: lineOf(ctx, p.id) - interest };
      }
      return { salary: 0, under: Infinity };
    };
    const pool = freeAgents(state).filter((p) => {
      const u = justUnder(p);
      return !state.rfaRights[p.id] && u.salary >= minSalary && u.under <= lowball;
    });
    const temper = (p: Player) => personalityOf(p.id).temperament;
    const calm = pool.reduce((a, b) => (temper(b) > temper(a) ? b : a));
    const hot = pool.reduce((a, b) => (temper(b) < temper(a) ? b : a));
    const patience = (p: Player) => talksLeft(state, ctx, p.id, mine);
    const full = { calm: patience(calm), hot: patience(hot) };
    expect(full.calm).toBeGreaterThan(full.hot);
    // Each offer he turns down spends a round, until he breaks off talks.
    const heard = (p: Player) => {
      let n = 0;
      while (patience(p) > 0) {
        countered(run(state, sign(p, mine, justUnder(p).salary, 2)));
        n++;
      }
      return n;
    };
    expect(heard(calm)).toBe(full.calm);
    expect(heard(hot)).toBe(full.hot);
    expect(handleCommand(state, sign(calm, mine, askOf(calm) * 2, 2), local, ctx)).toMatchObject({
      ok: false,
      error: { message: 'he has broken off talks with you' },
    });

    // A lowball, far under his line, spends two rounds.
    const lowballed = freeAgents(state).find((p) => {
      const salary = Math.round(askOf(p) * 0.6);
      const { interest } = signingInterest(state, ctx, p, mine, { salary, years: 2 });
      return (
        !state.rfaRights[p.id] &&
        salary >= minSalary &&
        lineOf(ctx, p.id) - interest > lowball &&
        patience(p) >= 3
      );
    })!;
    const left = patience(lowballed);
    const reply = countered(
      run(state, sign(lowballed, mine, Math.round(askOf(lowballed) * 0.6), 2)),
    );
    expect(reply.rounds).toBe(left - 2);

    // When free agency opens again, every team gets his full patience back.
    applyEvent(state, { ...reply, kind: 'freeAgency.opened' } as LeagueEvent);
    expect(state.talks).toEqual({});
    expect(patience(calm)).toBe(full.calm);
    expect(handleCommand(state, sign(calm, mine, justUnder(calm).salary, 2), local, ctx).ok).toBe(
      true,
    );
  });

  it('a re-sign under his line is countered, and one over it extends him', () => {
    const state = createLeague(61, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    run(state, { kind: 'sim.advance', days: 40 });
    const offer = resignOffers(state, ctx, mine).sort((a, b) => b.ask - a.ask)[0]!;
    const resign = (salary: number): Command => ({
      kind: 'contract.resign',
      playerId: offer.playerId,
      salary,
      years: 3,
    });
    const reply = countered(run(state, resign(Math.round(offer.ask * 0.7))));
    expect(reply).toMatchObject({ playerId: offer.playerId, teamId: mine });
    const [ev] = run(state, resign(reply.counter!));
    expect(ev).toMatchObject({ kind: 'contract.extended', contract: { capHit: reply.counter } });
  });
});

describe('the pitch', () => {
  it('a promised role scores 100; one promise a position; not first by day PROMISE_DAYS, a dispute', () => {
    const { state, mine } = finishedSeason(22);
    run(state, { kind: 'offseason.openFreeAgency' });
    state.teamStatus[mine] = 'contender';
    const pitch = (p: Player): Command => ({
      kind: 'contract.sign',
      playerId: p.id,
      teamId: mine,
      salary: ctx.models.contractDemand.ask(ctx.ruleset, p) * 2,
      years: 2,
      promiseRole: true,
    });
    const role = (p: Player, promiseRole?: true) =>
      signingInterest(state, ctx, p, mine, {
        salary: 1,
        years: 1,
        ...(promiseRole && { promiseRole }),
      }).factors.find((f) => f.key === 'role')!.score;
    // Unrestricted skaters nobody bids for, weakest first, who would sit behind someone without it.
    const pool = freeAgents(state)
      .filter((p) => !state.rfaRights[p.id] && p.position !== 'G' && role(p) < 100)
      .sort((a, b) => overall(a) - overall(b));
    const a = pool[0]!;
    const b = pool.find((p) => p.position !== a.position)!;
    const c = pool.find((p) => p.position === a.position && p !== a)!;
    expect(role(a, true)).toBe(100);

    expect(run(state, pitch(a))[0]).toMatchObject({ kind: 'player.signed', promiseRole: true });
    expect(run(state, pitch(b))[0]).toMatchObject({ kind: 'player.signed', promiseRole: true });
    expect(handleCommand(state, pitch(c), local, ctx)).toMatchObject({
      ok: false,
      error: { message: 'you have promised that role to another player' },
    });

    // The promises carry into his first season; on day PROMISE_DAYS `a` is first at his position, `b` last.
    run(state, { kind: 'season.rollover' });
    expect(state.rolePromises.map((r) => r.playerId).sort()).toEqual([a.id, b.id].sort());
    const others = (p: Player) =>
      Object.values(state.players)
        .filter((x) => x.teamId === mine && x.position === p.position && x !== p)
        .map((x) => x.id);
    state.depthCharts[mine] = [a.id, ...others(a), ...others(b), b.id];
    state.date.day = PROMISE_DAYS - 1;
    disputesWeek(state, ctx, new Rng(1), emitter(state, [] as LeagueEvent[]));
    expect(state.rolePromises).toHaveLength(2); // not due yet
    state.date.day = PROMISE_DAYS;
    const log: LeagueEvent[] = [];
    disputesWeek(state, ctx, new Rng(1), emitter(state, log));
    expect(state.rolePromises).toEqual([]);
    const due = log.flatMap((e) =>
      e.kind === 'player.rolePromiseDue' ? [[e.playerId, e.kept]] : [],
    );
    expect(Object.fromEntries(due)).toEqual({ [a.id]: true, [b.id]: false });
    expect(state.disputes.some((d) => d.playerId === b.id)).toBe(true);
    expect(state.disputes.some((d) => d.playerId === a.id)).toBe(false);
  });
});

describe('re-signing with his own team', () => {
  it('keeps his time with the team (chemistry does not reset)', () => {
    const { state } = finishedSeason(12);
    const before = new Map(Object.values(state.players).map((p) => [p.id, p.joined]));
    const stayed = run(state, { kind: 'offseason.openFreeAgency' }).flatMap((e) =>
      e.kind === 'player.signed' && e.staying ? [e.playerId] : [],
    );
    expect(stayed.length).toBeGreaterThan(0);
    for (const id of stayed) expect(state.players[id]!.joined).toBe(before.get(id));
  });

  const ids = Array.from({ length: 500 }, (_, i) => `p${i}`);
  const most = (trait: 'loyalty' | 'ambition', sign: 1 | -1) =>
    ids.reduce((a, b) => (sign * personalityOf(b)[trait] > sign * personalityOf(a)[trait] ? b : a));

  it('depends on the player: loyalty, and winning if he is ambitious', () => {
    expect(stayChance('bubble', most('loyalty', 1))).toBeGreaterThan(
      stayChance('bubble', most('loyalty', -1)) + 0.3,
    );
    // Winning pulls an ambitious player harder, both ways.
    const pull = (id: string) => stayChance('contender', id) - stayChance('rebuilder', id);
    expect(pull(most('ambition', 1))).toBeGreaterThan(pull(most('ambition', -1)));
    // Centred on the average player: a team status keeps its overall rate (0.6 on the bubble).
    const mean = ids.reduce((sum, id) => sum + stayChance('bubble', id), 0) / ids.length;
    expect(mean).toBeCloseTo(0.6, 1);
  });
});
