import { describe, expect, it } from 'vitest';
import type { Actor, Command, TeamId } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  handleCommand,
  hometownOf,
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

/** Free agency is open; one free agent is restricted, his rights held by `mine`, with an AI team's sheet on the table. */
function withSheet(seed: number) {
  const state = createLeague(seed, ctx);
  run(state, { kind: 'sim.advance', days: 300 });
  run(state, { kind: 'offseason.openFreeAgency' });
  const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
  const ai = Object.keys(state.teams).filter((id) => id !== mine) as TeamId[];
  for (const player of Object.values(state.players).filter((p) => p.teamId === null)) {
    for (const teamId of ai) {
      const trial = structuredClone(state);
      trial.rfaRights[player.id] = mine;
      const ask = ctx.models.contractDemand.ask(ctx.ruleset, player);
      trial.faOffers = [{ playerId: player.id, teamId, salary: ask * 2, years: 2 }];
      trial.teamStatus[teamId] = 'contender';
      run(trial, { kind: 'freeAgency.advanceDay' });
      if (trial.rfaSheets.length > 0) return { state: trial, mine, player, from: teamId };
    }
  }
  throw new Error('no sheet could be made');
}

describe('restricted free agents', () => {
  it('unsigned young players keep their team as rights holder; veterans do not', () => {
    const state = createLeague(5, ctx);
    run(state, { kind: 'sim.advance', days: 300 });
    run(state, { kind: 'offseason.openFreeAgency' });
    const rights = Object.entries(state.rfaRights);
    expect(rights.length).toBeGreaterThan(0);
    for (const [id, teamId] of rights) {
      expect(state.players[id]!.teamId).toBeNull();
      expect(state.players[id]!.birthYear).toBeGreaterThan(
        state.date.season + 1 - ctx.ruleset.contracts.ufaAge,
      );
      expect(state.teams[teamId]).toBeDefined();
    }
  });

  it('an offer sheet waits for the human rights team, who can match it', () => {
    const { state, mine, player, from } = withSheet(5);
    expect(state.players[player.id]!.teamId).toBeNull();
    run(state, { kind: 'freeAgency.matchSheet', playerId: player.id, teamId: mine });
    expect(state.players[player.id]!.teamId).toBe(mine);
    expect(state.rfaSheets).toEqual([]);
    expect(state.rfaRights[player.id]).toBeUndefined();
    expect(from).not.toBe(mine);
  });

  it('declining sends him to the team that made the sheet; silence does the same next day', () => {
    const a = withSheet(5);
    run(a.state, { kind: 'freeAgency.declineSheet', playerId: a.player.id, teamId: a.mine });
    expect(a.state.players[a.player.id]!.teamId).toBe(a.from);

    const b = withSheet(5);
    run(b.state, { kind: 'freeAgency.advanceDay' });
    expect(b.state.players[b.player.id]!.teamId).toBe(b.from);
    expect(b.state.rfaSheets).toEqual([]);
  });

  it('only the rights holder answers a sheet', () => {
    const { state, player, from } = withSheet(5);
    const res = handleCommand(
      state,
      { kind: 'freeAgency.matchSheet', playerId: player.id, teamId: from },
      local,
      ctx,
    );
    expect(res.ok).toBe(false);
  });

  it('your offer to another team’s restricted player is never instant', () => {
    const state = createLeague(5, ctx);
    run(state, { kind: 'sim.advance', days: 300 });
    run(state, { kind: 'offseason.openFreeAgency' });
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const [id] = Object.entries(state.rfaRights).find(([, t]) => t !== mine)!;
    const p = state.players[id!]!;
    const ask = ctx.models.contractDemand.ask(ctx.ruleset, p);
    state.teamStatus[mine] = 'contender';
    const res = handleCommand(
      state,
      { kind: 'contract.sign', playerId: p.id, teamId: mine, salary: ask * 2, years: 2 },
      local,
      ctx,
    );
    if (res.ok) expect(res.events[0]!.kind).toBe('freeAgency.offered');
    expect(p.teamId).toBeNull();
  });
});

describe('loyalty and hometown', () => {
  it('a free agent likes his old team and his hometown more for the same offer', () => {
    const state = createLeague(5, ctx);
    run(state, { kind: 'sim.advance', days: 300 });
    run(state, { kind: 'offseason.openFreeAgency' });
    const teams = Object.keys(state.teams) as TeamId[];
    const [id, former] = Object.entries(state.formerTeams).find(
      ([pid]) => state.players[pid]!.teamId === null,
    )!;
    const p = state.players[id!]!;
    const offer = { salary: ctx.models.contractDemand.ask(ctx.ruleset, p), years: 2 };
    const other = teams.find((t) => t !== former && hometownOf(p.id, teams) !== t)!;
    const home = signingInterest(state, ctx, p, former!, offer);
    const away = signingInterest(state, ctx, p, other, offer);
    expect(home.factors.some((f) => f.key === 'loyalty')).toBe(true);
    expect(away.factors.some((f) => f.key === 'loyalty')).toBe(false);
    // The weights still add up to one with the pulls counted.
    expect(home.factors.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1, 5);
  });

  it("a hometown never changes: the same team every time, and every team is someone's home", () => {
    const teams = ['a', 'b', 'c', 'd'];
    expect(hometownOf('p1', teams)).toBe(hometownOf('p1', [...teams].reverse()));
    const homes = new Set(Array.from({ length: 200 }, (_, i) => hometownOf(`p${i}`, teams)));
    expect(homes.size).toBe(teams.length);
  });
});
