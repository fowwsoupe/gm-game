import { describe, expect, it } from 'vitest';
import type { Actor, Command, Player, TeamId } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  handleCommand,
  personalityOf,
  signingInterest,
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
