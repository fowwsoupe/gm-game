import { describe, expect, it } from 'vitest';
import type { Actor, Command, Player, TeamId } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  handleCommand,
  overall,
  personalityOf,
  roomFor,
  seenBy,
  signFreeAgent,
  signingInterest,
  stayChance,
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
    ).toBeGreaterThanOrEqual(view.threshold);
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

  it('refuses a lowball, a player under contract and a team with no room', () => {
    const { state, mine } = finishedSeason(23);
    run(state, { kind: 'offseason.openFreeAgency' });
    const target = freeAgents(state)[0]!;
    const { ask } = signingInterest(state, ctx, target, mine, { salary: 0, years: 1 });
    const lowball = handleCommand(state, sign(target, mine, Math.round(ask * 0.5), 1), local, ctx);
    expect(lowball.ok).toBe(false);

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
    const res = handleCommand(
      state,
      { kind: 'contract.resign', playerId: own.id, years: 2.5 },
      local,
      ctx,
    );
    expect(res.ok).toBe(false);
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

    // Next day he signs somewhere; if it was not with you, you are told.
    const events = run(state, { kind: 'freeAgency.advanceDay' });
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
      (t) => !t.userControlled && size(t.id) < maxActive,
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
