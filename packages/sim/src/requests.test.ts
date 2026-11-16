import { describe, expect, it } from 'vitest';
import type { Actor, LeagueEvent } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  emitter,
  handleCommand,
  resignOffers,
  Rng,
  talkedDown,
  tradeRequests,
  type LeagueState,
} from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

/** A league where the human team is rebuilding and one of its players has asked out. */
function withRequest(): LeagueState {
  for (let seed = 1; seed < 40; seed++) {
    const state = createLeague(100 + seed, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    state.teamStatus[mine] = 'rebuilder';
    for (let week = 0; week < 30 && state.tradeRequests.length === 0; week++) {
      tradeRequests(state, new Rng(seed * 100 + week), emitter(state, [] as LeagueEvent[]));
    }
    if (state.tradeRequests.length) return state;
  }
  throw new Error('no request');
}

describe('trade requests', () => {
  it('come from an ambitious veteran on a struggling human team, one at a time', () => {
    const state = withRequest();
    const [request] = state.tradeRequests;
    const p = state.players[request!.playerId]!;
    expect(state.teams[request!.teamId]!.userControlled).toBe(true);
    expect(state.date.season - p.birthYear).toBeGreaterThanOrEqual(27);
    tradeRequests(state, new Rng(1), emitter(state, []));
    expect(state.tradeRequests.length).toBe(1);
  });

  it('block re-signing, and a talk ends them only for a loyal, professional player', () => {
    const state = withRequest();
    const { playerId, teamId } = state.tradeRequests[0]!;
    // His deal ends this season and the season is over: he still won't re-sign.
    state.players[playerId]!.contract!.expiresAfterSeason = state.date.season;
    state.championTeamId = teamId;
    expect(resignOffers(state, ctx, teamId).some((o) => o.playerId === playerId)).toBe(false);
    const res = handleCommand(state, { kind: 'tradeRequest.talk', playerId }, local, ctx);
    expect(res.ok).toBe(true);
    expect(state.tradeRequests.length).toBe(talkedDown(playerId) ? 0 : 1);
  });
});
