import { describe, expect, it } from 'vitest';
import type { Actor } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  draftPicks,
  draftSlot,
  handleCommand,
  onTheClock,
  picksLeft,
  worstFirst,
  type LeagueState,
} from './index';

const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();

function finished(seed: number) {
  const state = createLeague(seed, ctx);
  const res = handleCommand(state, { kind: 'sim.advance', days: 300 }, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
  return { state, mine };
}

const mid = (d: LeagueState['draftClass'][number]) => (d.low + d.high) / 2;

describe('draft', () => {
  it('announces a scouted class when the champion is crowned', () => {
    const { state } = finished(31);
    const teams = Object.keys(state.teams).length;
    expect(state.draftClass.length).toBe(teams * ctx.ruleset.draft.rounds);
    for (const d of state.draftClass) {
      expect(d.low).toBeLessThanOrEqual(d.high);
      expect(d.player.teamId).toBeNull();
    }
    // Best scouted first, and the scouts are sometimes wrong about the order.
    const mids = state.draftClass.map(mid);
    expect(mids).toEqual([...mids].sort((a, b) => b - a));
    const truth = state.draftClass.map((d) => d.player.potential);
    expect(truth).not.toEqual([...truth].sort((a, b) => b - a));
  });

  it('your first pick is the first player still on your board', () => {
    const { state, mine } = finished(32);
    // Nobody else wants the worst-scouted prospect, so he is there at your first pick.
    const sleeper = state.draftClass.at(-1)!.player.id;
    const set = handleCommand(
      state,
      { kind: 'draft.setBoard', teamId: mine, order: [sleeper] },
      local,
      ctx,
    );
    expect(set.ok).toBe(true);
    const res = handleCommand(state, { kind: 'offseason.openFreeAgency' }, local, ctx);
    if (!res.ok) throw new Error(res.error.message);
    const picks = res.events.filter((e) => e.kind === 'player.drafted' && e.round > 0);
    const myFirst = picks.find((e) => e.kind === 'player.drafted' && e.player.teamId === mine);
    expect(myFirst?.kind === 'player.drafted' && myFirst.player.id).toBe(sleeper);
    expect(state.draftClass).toEqual([]);
    // Everyone else picked the best scouted player left.
    expect(picks.length).toBe(Object.keys(state.teams).length * ctx.ruleset.draft.rounds);
  });

  it('holds the draft live: AI teams pick until you are on the clock, then you pick', () => {
    const { state, mine } = finished(34);
    const total = Object.keys(state.teams).length * ctx.ruleset.draft.rounds;
    const start = handleCommand(state, { kind: 'offseason.startDraft' }, local, ctx);
    if (!start.ok) throw new Error(start.error.message);
    expect(state.freeAgencyOpen).toBe(false);
    const clock = onTheClock(state, ctx)!;
    expect(clock.teamId).toBe(mine);
    expect(state.draftPicksMade).toBe(clock.pick - 1);
    expect(handleCommand(state, { kind: 'offseason.startDraft' }, local, ctx).ok).toBe(false);
    // Picks already made are gone from the trade market; yours on the clock is still there.
    const tradeable = draftPicks(state, ctx.ruleset).map((p) => p.id);
    const order = worstFirst(state, ctx.ruleset);
    expect(tradeable).toContain(draftSlot(state, order, clock.pick - 1).id);
    for (let i = 0; i < clock.pick - 1; i++) {
      expect(tradeable).not.toContain(draftSlot(state, order, i).id);
    }

    const other = Object.values(state.teams).find((t) => !t.userControlled)!.id;
    const sleeper = state.draftClass.at(-1)!.player.id;
    expect(
      handleCommand(state, { kind: 'draft.pick', teamId: other, playerId: sleeper }, local, ctx),
    ).toMatchObject({ ok: false, error: { code: 'not_allowed' } });
    const pick = handleCommand(
      state,
      { kind: 'draft.pick', teamId: mine, playerId: sleeper },
      local,
      ctx,
    );
    if (!pick.ok) throw new Error(pick.error.message);
    expect(state.prospects[sleeper]?.player.teamId).toBe(mine);
    expect(onTheClock(state, ctx)?.teamId).toBe(mine);

    // Opening free agency finishes the draft for you, by your board.
    const rest = handleCommand(state, { kind: 'offseason.openFreeAgency' }, local, ctx);
    if (!rest.ok) throw new Error(rest.error.message);
    expect(state.draftClass).toEqual([]);
    expect(state.draftPicksMade).toBeNull();
    expect(state.freeAgencyOpen).toBe(true);
    const drafted = [...start.events, ...pick.events, ...rest.events].filter(
      (e) => e.kind === 'player.drafted' && e.round > 0,
    );
    expect(drafted.length).toBe(total);
  });

  it('trading the pick on the clock to an AI team: he makes it and the draft runs on', () => {
    const { state, mine } = finished(37);
    const total = Object.keys(state.teams).length * ctx.ruleset.draft.rounds;
    const start = handleCommand(state, { kind: 'offseason.startDraft' }, local, ctx);
    if (!start.ok) throw new Error(start.error.message);
    const onClock = picksLeft(state, ctx)[0]!;
    expect(onClock).toEqual(onTheClock(state, ctx));
    expect(onClock.teamId).toBe(mine);
    expect(picksLeft(state, ctx).length).toBe(total - onClock.pick + 1);

    const other = Object.values(state.teams).find((t) => !t.userControlled)!.id;
    const traded = handleCommand(
      state,
      {
        kind: 'trade.propose',
        proposal: { fromTeamId: mine, toTeamId: other, give: [], get: [], givePicks: [onClock.id] },
      },
      local,
      ctx,
    );
    if (!traded.ok) throw new Error(traded.error.message);
    const madeWithIt = traded.events.find(
      (e) => e.kind === 'player.drafted' && e.pick === onClock.pick,
    );
    expect(madeWithIt?.kind === 'player.drafted' && madeWithIt.player.teamId).toBe(other);
    // The pick is tracked as yours, made by the team you traded it to.
    expect(madeWithIt?.kind === 'player.drafted' && madeWithIt.via).toBe(mine);
    // Your next pick is on the clock, or you had none left and free agency is open.
    const next = onTheClock(state, ctx);
    if (next) {
      expect(next.teamId).toBe(mine);
      expect(next.pick).toBeGreaterThan(onClock.pick);
    } else expect(state.freeAgencyOpen).toBe(true);
  });

  it('draft-day calls: AI teams trade up with each other, and call you while you are on the clock', () => {
    const { state, mine } = finished(25);
    const start = handleCommand(state, { kind: 'offseason.startDraft' }, local, ctx);
    if (!start.ok) throw new Error(start.error.message);
    const clock = onTheClock(state, ctx)!;
    expect(clock.teamId).toBe(mine);
    const call = state.tradeOffers.find((o) => o.proposal.getPicks?.includes(clock.id))!;
    const caller = call.proposal.fromTeamId;
    expect(state.teams[caller]!.userControlled).toBe(false);
    // The caller moves up with a later pick of this draft (and maybe one more).
    expect(picksLeft(state, ctx).find((p) => p.id === call.proposal.givePicks![0])?.teamId).toBe(
      caller,
    );

    // You take it: the caller makes your pick, and his picks are yours.
    const took = handleCommand(
      state,
      { kind: 'trade.respond', offerId: call.id, accept: true },
      local,
      ctx,
    );
    if (!took.ok) throw new Error(took.error.message);
    const used = took.events.find((e) => e.kind === 'player.drafted' && e.pick === clock.pick);
    expect(used?.kind === 'player.drafted' && used.player.teamId).toBe(caller);
    for (const id of call.proposal.givePicks!) expect(state.pickOwners[id]).toBe(mine);
    expect(state.tradeOffers.some((o) => o.id === call.id)).toBe(false);

    // A call you do not answer closes when the pick on the clock is made.
    const next = onTheClock(state, ctx)!;
    expect(next.teamId).toBe(mine);
    const second = state.tradeOffers.find((o) => o.proposal.getPicks?.includes(next.id))!;
    expect(second).toBeDefined();
    const pick = handleCommand(
      state,
      { kind: 'draft.pick', teamId: mine, playerId: state.draftClass[0]!.player.id },
      local,
      ctx,
    );
    if (!pick.ok) throw new Error(pick.error.message);
    expect(state.tradeOffers.some((o) => o.id === second.id)).toBe(false);

    // AI teams traded picks with each other along the way.
    const aiTrades = [...start.events, ...took.events, ...pick.events].filter(
      (e) =>
        e.kind === 'trade.completed' &&
        !state.teams[e.fromTeamId]!.userControlled &&
        !state.teams[e.toTeamId]!.userControlled,
    );
    expect(aiTrades.length).toBeGreaterThan(0);
  });

  it('refuses a board with players outside the class, or for another team', () => {
    const { state, mine } = finished(33);
    const bad = handleCommand(
      state,
      { kind: 'draft.setBoard', teamId: mine, order: [Object.values(state.players)[0]!.id] },
      local,
      ctx,
    );
    expect(bad.ok).toBe(false);
    const other = Object.values(state.teams).find((t) => !t.userControlled)!.id;
    const theirs = handleCommand(
      state,
      { kind: 'draft.setBoard', teamId: other, order: [] },
      local,
      ctx,
    );
    expect(theirs).toMatchObject({ ok: false, error: { code: 'not_allowed' } });
  });
});
