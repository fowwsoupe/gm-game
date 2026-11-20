import { describe, expect, it } from 'vitest';
import type { Actor, Command, TeamId } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  handleCommand,
  hometownOf,
  nextDraftSeason,
  roomFor,
  scoutReport,
  sheetCompensation,
  signFreeAgent,
  signingInterest,
  type LeagueState,
} from './index';
import { freeAgencyLeague, summerLeague } from './testLeagues';

const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

/** Free agency is open; one free agent is restricted, his rights held by `mine`, with an AI team's sheet on the table. */
function findSheet(seed: number) {
  const state = freeAgencyLeague(seed);
  const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
  const ai = Object.keys(state.teams).filter((id) => id !== mine) as TeamId[];
  for (const player of Object.values(state.players).filter((p) => p.teamId === null)) {
    for (const teamId of ai) {
      // Skip the pairs he would turn down anyway (a full day per try is slow).
      const ask = ctx.models.contractDemand.ask(ctx.ruleset, player);
      if (!roomFor(state, ctx, teamId, player, ask * 2)) continue;
      const trial = structuredClone(state);
      trial.rfaRights[player.id] = mine;
      trial.faOffers = [{ playerId: player.id, teamId, salary: ask * 2, years: 2 }];
      trial.teamStatus[teamId] = 'contender';
      run(trial, { kind: 'freeAgency.advanceDay' });
      if (trial.rfaSheets.length > 0) return { state: trial, mine, player, from: teamId };
    }
  }
  throw new Error('no sheet could be made');
}

const sheets = new Map<number, ReturnType<typeof findSheet>>();
/** `findSheet`, searched once per seed. A fresh copy each call. */
function withSheet(seed: number) {
  if (!sheets.has(seed)) sheets.set(seed, findSheet(seed));
  return structuredClone(sheets.get(seed)!);
}

describe('restricted free agents', () => {
  it('unsigned young players keep their team as rights holder; veterans do not', () => {
    const state = freeAgencyLeague(5);
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
    // His sheet is gone (that day can bring other players' sheets).
    expect(b.state.rfaSheets.filter((s) => s.playerId === b.player.id)).toEqual([]);
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
    const state = freeAgencyLeague(5);
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
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.events[0]!.kind).toBe('freeAgency.offered');
    expect(p.teamId).toBeNull();
  });
});

describe('offer-sheet compensation', () => {
  const tiers = ctx.ruleset.contracts.offerSheetCompensation;

  it('costs picks by the cap hit tier, first-rounders from the next drafts in a row', () => {
    const { state, player, from } = withSheet(5);
    const cost = (capHit: number) => sheetCompensation(state, ctx.ruleset, player, from, capHit);
    const next = nextDraftSeason(state);
    expect(cost(tiers[0]!.minCapHit - 1)).toEqual({ picks: [], owned: true });
    expect(cost(tiers[1]!.minCapHit).picks).toEqual([`${next}-1-${from}`]);
    expect(cost(tiers.at(-1)!.minCapHit).picks).toEqual(
      [0, 1, 2, 3].map((n) => `${next + n}-1-${from}`),
    );
    // Not restricted, or his own team: nothing.
    expect(sheetCompensation(state, ctx.ruleset, player, state.rfaRights[player.id]!, 1e8)).toEqual(
      { picks: [], owned: true },
    );
  });

  it('a team without its own first-rounder cannot send a first-round sheet', () => {
    const { state, player, from, mine } = withSheet(5);
    const sheet = state.rfaSheets[0]!;
    state.rfaSheets = [];
    state.pickOwners[`${nextDraftSeason(state)}-1-${from}`] = mine;
    expect(
      signFreeAgent(state, ctx, player, from, { salary: tiers[1]!.minCapHit, years: 2 }),
    ).toEqual({ error: 'not enough draft picks for an offer sheet' });
    expect(sheet.teamId).toBe(from);
  });

  it('a sheet that stands sends the picks to the team that held his rights', () => {
    const { state, player, from, mine } = withSheet(5);
    const sheet = state.rfaSheets[0]!;
    sheet.salary = Math.max(sheet.salary, tiers[0]!.minCapHit);
    const { picks } = sheetCompensation(state, ctx.ruleset, player, from, sheet.salary);
    expect(picks.length).toBeGreaterThan(0);
    run(state, { kind: 'freeAgency.declineSheet', playerId: player.id, teamId: mine });
    expect(state.players[player.id]!.teamId).toBe(from);
    for (const id of picks) expect(state.pickOwners[id]).toBe(mine);
  });
});

describe('loyalty and hometown', () => {
  it('a free agent likes his old team and his hometown more for the same offer', () => {
    const state = freeAgencyLeague(5);
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

describe('goalie rotation', () => {
  it('only the team that owns it can change it, and it applies to later games', () => {
    const state = createLeague(5, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const other = Object.keys(state.teams).find((t) => t !== mine) as TeamId;
    expect(
      handleCommand(
        state,
        { kind: 'goalies.setRotation', teamId: other, rotation: 'always' },
        { id: 'x', controls: [mine] },
        ctx,
      ).ok,
    ).toBe(false);
    run(state, { kind: 'goalies.setRotation', teamId: mine, rotation: 'split' });
    expect(state.goalieRotation[mine]).toBe('split');
    // A season still plays out legally with the setting on.
    run(state, { kind: 'sim.advance', days: 40 });
    expect(Object.keys(state.results).length).toBeGreaterThan(0);
  });
});

describe('scout reports', () => {
  it('are the same every time and name real rating keys', () => {
    const state = summerLeague(5);
    expect(state.draftClass.length).toBeGreaterThan(0);
    for (const d of state.draftClass.slice(0, 20)) {
      const a = scoutReport(ctx, d);
      expect(scoutReport(ctx, d)).toEqual(a);
      const keys = ctx.sport.ratingKeys(d.player.position);
      expect(a.strengths).toHaveLength(2);
      for (const k of [...a.strengths, a.weakness]) expect(keys).toContain(k);
      expect(a.strengths).not.toContain(a.weakness);
    }
  });
});

describe('trade block', () => {
  it('lists only your own players, and a trade clears the listing', () => {
    const state = createLeague(5, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const own = Object.values(state.players).find((p) => p.teamId === mine)!;
    const theirs = Object.values(state.players).find((p) => p.teamId !== mine && p.teamId)!;
    expect(
      handleCommand(
        state,
        { kind: 'trade.block', teamId: mine, playerId: theirs.id, onBlock: true },
        local,
        ctx,
      ).ok,
    ).toBe(false);
    run(state, { kind: 'trade.block', teamId: mine, playerId: own.id, onBlock: true });
    expect(state.tradeBlock).toEqual([own.id]);
    run(state, { kind: 'trade.block', teamId: mine, playerId: own.id, onBlock: false });
    expect(state.tradeBlock).toEqual([]);
  });

  it('AI offers ask for the listed player', () => {
    const state = createLeague(5, ctx);
    run(state, { kind: 'sim.advance', days: 3 });
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const own = Object.values(state.players).filter((p) => p.teamId === mine);
    run(state, { kind: 'trade.block', teamId: mine, playerId: own[7]!.id, onBlock: true });
    run(state, { kind: 'sim.advance', days: 120 });
    const asked = state.tradeOffers.flatMap((o) => o.proposal.get);
    // Every open offer to a team with a listed player that is still its own is for him.
    for (const id of asked) expect(id).toBe(own[7]!.id);
  });
});

describe('protected picks', () => {
  it('a protected first-round pick that lands high stays with the team that traded it', () => {
    const state = summerLeague(5);
    const [a, b] = Object.keys(state.teams) as TeamId[];
    const id = `${state.date.season + 1}-1-${a}`;
    state.pickOwners[id] = b!;
    state.pickProtection[id] = { top: 100, keeper: a! };
    const events = run(state, { kind: 'season.rollover' });
    const firstRound = (team: TeamId) =>
      events.filter(
        (e) => e.kind === 'player.drafted' && e.round === 1 && e.player.teamId === team,
      );
    // Traded without protection `a` would have none and `b` two; protected, each keeps its own.
    expect(firstRound(a!)).toHaveLength(1);
    expect(firstRound(b!)).toHaveLength(1);
    expect(state.pickProtection[id]).toBeUndefined();
  });
});

describe('stale listings', () => {
  it('a player who leaves his team (expiry, buyout, retirement) leaves the trade block and the maps', () => {
    const state = createLeague(5, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const own = Object.values(state.players).filter((p) => p.teamId === mine);
    for (const p of own.slice(0, 3)) {
      run(state, { kind: 'trade.block', teamId: mine, playerId: p.id, onBlock: true });
    }
    run(state, { kind: 'sim.advance', days: 300 });
    run(state, { kind: 'contract.buyout', playerId: own[0]!.id });
    expect(state.tradeBlock).not.toContain(own[0]!.id);
    run(state, { kind: 'season.rollover' });
    const live = new Set(Object.keys(state.players));
    for (const id of [
      ...state.tradeBlock,
      ...Object.keys(state.rfaRights),
      ...Object.keys(state.formerTeams),
    ]) {
      expect(live.has(id)).toBe(true);
    }
    expect(state.tradeBlock.every((id) => state.players[id]!.teamId === mine)).toBe(true);
  });
});
