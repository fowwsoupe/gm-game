import { describe, expect, it } from 'vitest';
import type { Actor, LeagueEvent, Player, TeamId } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  disputesWeek,
  emitter,
  handleCommand,
  moraleOf,
  personalityOf,
  PROMISE_DAYS,
  Rng,
  roleGap,
  talkedDown,
  type LeagueState,
} from './index';
import { byOverall } from './players';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

/** A league where your best ambitious player of a deep position is put at the bottom of its order. */
function benched() {
  const state = createLeague(2, ctx);
  const teamId = Object.values(state.teams).find((t) => t.userControlled)!.id;
  const roster = Object.values(state.players).filter((p) => p.teamId === teamId);
  const player = [...roster]
    .sort(byOverall)
    .find(
      (p) =>
        personalityOf(p.id).ambition >= 0.6 &&
        roster.filter((q) => q.position === p.position).length >= 4,
    )!;
  const rest = roster.filter((p) => p.id !== player.id).sort(byOverall);
  state.depthCharts[teamId] = [...rest, player].map((p) => p.id);
  // A losing team he has just joined, underpaid: low spirits.
  state.teamStatus[teamId] = 'crisis';
  player.joined = state.date.season;
  if (player.contract) player.contract.capHit = 1;
  return { state, teamId, player };
}

function startDispute(state: LeagueState) {
  for (let i = 0; i < 200 && state.disputes.length === 0; i++) {
    disputesWeek(state, ctx, new Rng(i), emitter(state, [] as LeagueEvent[]));
  }
}

const talk = (state: LeagueState, player: Player, answer: 'promise' | 'patience' | 'block') =>
  handleCommand(state, { kind: 'dispute.talk', playerId: player.id, answer }, local, ctx);

describe('disputes', () => {
  it('a player kept well down the order for his rating has a role gap and asks for more', () => {
    const { state, teamId, player } = benched();
    expect(roleGap(state, teamId, player)).toBeGreaterThanOrEqual(2);
    startDispute(state);
    expect(state.disputes).toEqual([{ playerId: player.id, teamId }]);
  });

  it('a benched player in high spirits does not complain', () => {
    const { state, player } = benched();
    expect(moraleOf(state, ctx, player).value).toBeLessThan(45);
    state.teamStatus[player.teamId!] = 'contender';
    player.joined = state.date.season - 5;
    if (player.contract) {
      player.contract.capHit = ctx.models.contractDemand.ask(ctx.ruleset, player) * 2;
    }
    expect(moraleOf(state, ctx, player).value).toBeGreaterThanOrEqual(45);
    startDispute(state);
    expect(state.disputes).toEqual([]);
  });

  it('a broken promise becomes a trade request; a kept one settles it', () => {
    for (const keep of [false, true]) {
      const { state, teamId, player } = benched();
      startDispute(state);
      expect(talk(state, player, 'promise').ok).toBe(true);
      expect(talk(state, player, 'patience').ok).toBe(false); // promised already
      if (keep) state.depthCharts[teamId] = [player.id, ...state.depthCharts[teamId]!];
      state.date.day = Math.min(
        state.date.day + PROMISE_DAYS,
        ctx.ruleset.season.calendar.regularSeasonDays - 1,
      );
      const log: LeagueEvent[] = [];
      disputesWeek(state, ctx, new Rng(999), emitter(state, log));
      const ended = log.find((e) => e.kind === 'player.disputeEnded');
      expect(ended?.kind === 'player.disputeEnded' && ended.outcome).toBe(
        keep ? 'kept' : 'request',
      );
      expect(state.tradeRequests.some((r) => r.playerId === player.id)).toBe(!keep);
      expect(state.disputes).toEqual([]);
    }
  });

  it('patience is up to who he is; the block lists him until you take him off', () => {
    const a = benched();
    startDispute(a.state);
    expect(talk(a.state, a.player, 'patience').ok).toBe(true);
    expect(a.state.tradeRequests.some((r) => r.playerId === a.player.id)).toBe(
      !talkedDown(a.player.id),
    );
    expect(a.state.disputes).toEqual([]);
    const b = benched();
    startDispute(b.state);
    expect(talk(b.state, b.player, 'block').ok).toBe(true);
    expect(b.state.tradeBlock).toContain(b.player.id);
    // Listed, it waits; taken off the block, he asks for a trade.
    disputesWeek(b.state, ctx, new Rng(1), emitter(b.state, [] as LeagueEvent[]));
    expect(b.state.disputes).toHaveLength(1);
    expect(talk(b.state, b.player, 'patience').ok).toBe(false);
    const off = handleCommand(
      b.state,
      { kind: 'trade.block', teamId: b.teamId, playerId: b.player.id, onBlock: false },
      local,
      ctx,
    );
    expect(off.ok).toBe(true);
    disputesWeek(b.state, ctx, new Rng(1), emitter(b.state, [] as LeagueEvent[]));
    expect(b.state.disputes).toEqual([]);
    expect(b.state.tradeRequests.some((r) => r.playerId === b.player.id)).toBe(true);
  });

  it('nobody is short of a role on a team that never set its lines', () => {
    const state = createLeague(2, ctx);
    const teamId = Object.keys(state.teams)[0] as TeamId;
    for (const p of Object.values(state.players).filter((x) => x.teamId === teamId)) {
      expect(roleGap(state, teamId, p)).toBeLessThanOrEqual(0);
    }
  });
});
