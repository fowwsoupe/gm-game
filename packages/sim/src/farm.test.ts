import { describe, expect, it } from 'vitest';
import type { Actor, Command, LeagueEvent, Player, PlayerId, TeamId } from '@gm/shared';
import {
  Rng,
  applyEvent,
  createLeague,
  dashboard,
  defaultContext,
  dollars,
  emitter,
  handleCommand,
  sitsOut,
  teamCapTotal,
  type LeagueState,
} from './index';
import { aiFarmMoves } from './farm';

const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();
const { elcSalary } = ctx.ruleset.contracts;

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

/** A made-up player of `teamId` on an entry deal, every rating `rating`. */
function made(state: LeagueState, teamId: TeamId, id: string, position: string, rating: number) {
  const season = state.date.season;
  const base = ctx.sport.generateProspect(new Rng(1), { id, season, position });
  const ratings = Object.fromEntries(Object.keys(base.ratings).map((k) => [k, rating]));
  const player: Player = {
    ...base,
    teamId,
    ratings,
    potential: rating,
    birthYear: season - 25,
    contract: { capHit: elcSalary, expiresAfterSeason: season + 1 },
  };
  return (state.players[id as PlayerId] = player);
}

describe('the farm team', () => {
  it('a player sent down counts only his cap hit above the burial relief', () => {
    const state = createLeague(81, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const kid = made(state, mine, 'kid', 'C', 50);
    const vet = made(state, mine, 'vet', 'D', 50);
    vet.contract = { capHit: dollars(2), expiresAfterSeason: state.date.season + 1 };
    const total = () => teamCapTotal(ctx.ruleset, state, mine);
    const before = total();
    const over = () =>
      dashboard(state, ctx, mine).todo.find((x) => x.code === 'rosterOver')?.params?.count ?? 0;
    const wasOver = Number(over());
    const assign = (playerId: string, down: boolean): Command => ({
      kind: 'player.assign',
      teamId: mine,
      playerId: playerId as PlayerId,
      down,
    });

    run(state, assign('kid', true));
    expect(before - total()).toBe(elcSalary); // an entry deal counts nothing
    expect(kid.league).toBe('minors');
    run(state, assign('vet', true));
    expect(before - total()).toBe(elcSalary + dollars(1.225)); // $775K of his $2M counts
    expect(vet.league).toBe('minors');
    expect(sitsOut(state, vet, 0)).toBe(true);
    expect(handleCommand(state, assign('vet', true), local, ctx).ok).toBe(false);
    expect(over()).toBe(Math.max(0, wasOver - 2));

    run(state, assign('vet', false));
    expect(vet.league).toBeUndefined();
    expect(before - total()).toBe(elcSalary);
  });

  it('a 19-year-old from junior goes back to junior; from Europe, or at 20, to the minors', () => {
    const state = createLeague(82, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const sent = (id: string, league: string, age: number) => {
      const base = ctx.sport.generateProspect(new Rng(2), { id, season: state.date.season });
      const player = { ...base, teamId: mine, birthYear: state.date.season - age };
      state.prospects[id as PlayerId] = { player, league, round: 2, rightsEnd: 2099 };
      run(state, { kind: 'prospect.sign', teamId: mine, playerId: id as PlayerId });
      run(state, { kind: 'player.assign', teamId: mine, playerId: id as PlayerId, down: true });
      return state.players[id as PlayerId]!.league;
    };
    expect(sent('junior19', 'junior', 19)).toBe('junior');
    expect(state.players['junior19' as PlayerId]!.origin).toBe('junior');
    expect(sent('europe19', 'europe', 19)).toBe('minors');
    expect(sent('junior20', 'junior', 20)).toBe('minors');
  });

  it('an AI team cuts to 23 on opening night, calls up a centre for a hurt one, sends him back down', () => {
    const state = createLeague(83, ctx);
    const ai = Object.values(state.teams).find((t) => !t.userControlled)!.id;
    for (const p of Object.values(state.players)) if (p.teamId === ai) delete state.players[p.id];
    // 23 good players, a poor centre on the farm and a poor winger up: 25 signed.
    const lineup = { C: 4, LW: 5, RW: 5, D: 7, G: 2 };
    for (const [position, n] of Object.entries(lineup)) {
      for (let i = 0; i < n; i++) made(state, ai, `${position}${i}`, position, 65);
    }
    const farmC = made(state, ai, 'farmC', 'C', 30);
    farmC.league = 'minors';
    const spare = made(state, ai, 'spare', 'LW', 32);
    const replica = structuredClone(state);
    const events: LeagueEvent[] = [];
    const moves = (day: number) => aiFarmMoves(state, ctx, emitter(state, events), day);

    moves(0);
    expect(farmC.league).toBe('minors');
    expect(spare.league).toBe('minors');
    const up = () => Object.values(state.players).filter((p) => p.teamId === ai && !p.league);
    expect(up().length).toBe(23);

    // A centre is hurt until day 10: four centres no more, so the farm's comes up.
    state.players['C0' as PlayerId]!.injuredUntil = 10;
    replica.players['C0' as PlayerId]!.injuredUntil = 10;
    moves(5);
    expect(farmC.league).toBeUndefined();
    expect(spare.league).toBe('minors');
    moves(9);
    expect(farmC.league).toBeUndefined();
    // He is back: one healthy player too many, and the call-up is the worst.
    moves(10);
    expect(farmC.league).toBe('minors');
    expect(up().length).toBe(23);

    events.forEach((e) => applyEvent(replica, e));
    expect(replica).toEqual(state);
  });
});
