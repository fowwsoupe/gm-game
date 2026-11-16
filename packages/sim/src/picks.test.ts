import { describe, expect, it } from 'vitest';
import type { Actor } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  draftPicks,
  evaluateTrade,
  handleCommand,
  pickId,
  pickValue,
} from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };
const rules = ctx.ruleset;

describe('pick value', () => {
  const v = (slot: number, round = 1, yearsAway = 0, status = 'bubble' as const) =>
    pickValue(rules, { slot, teams: 16, round, yearsAway }, status);
  it('falls through the round, by round and by years away; rebuilders pay more', () => {
    expect(v(1)).toBeGreaterThan(v(8));
    expect(v(8)).toBeGreaterThan(v(16));
    expect(v(16)).toBeGreaterThan(v(1, 2));
    expect(v(1, 1, 1)).toBeLessThan(v(1));
    expect(
      pickValue(rules, { slot: 5, teams: 16, round: 1, yearsAway: 0 }, 'rebuilder'),
    ).toBeGreaterThan(
      pickValue(rules, { slot: 5, teams: 16, round: 1, yearsAway: 0 }, 'contender'),
    );
  });
});

describe('trading picks', () => {
  it('your traded first-rounder is made by the team that owns it', () => {
    const state = createLeague(81, ctx);
    const teams = Object.values(state.teams);
    const mine = teams.find((t) => t.userControlled)!.id;
    const partner = teams.find((t) => !t.userControlled)!.id;
    const mineFirst = pickId(state.date.season + 1, 1, mine);
    expect(draftPicks(state, rules.draft.rounds, mine).map((p) => p.id)).toContain(mineFirst);

    const res = handleCommand(
      state,
      {
        kind: 'trade.propose',
        proposal: {
          fromTeamId: mine,
          toTeamId: partner,
          give: [],
          get: [],
          givePicks: [mineFirst],
        },
      },
      local,
      ctx,
    );
    if (!res.ok) throw new Error(res.error.message);
    expect(state.pickOwners[mineFirst]).toBe(partner);
    expect(draftPicks(state, rules.draft.rounds, mine).map((p) => p.id)).not.toContain(mineFirst);
    // You can't trade it again; nor a pick that doesn't exist.
    const again = evaluateTrade(state, ctx, {
      fromTeamId: mine,
      toTeamId: partner,
      give: [],
      get: [],
      givePicks: [mineFirst],
    });
    expect(again.reasons[0]!.code).toBe('not_your_pick');
    expect(
      evaluateTrade(state, ctx, {
        fromTeamId: mine,
        toTeamId: partner,
        give: [],
        get: [],
        givePicks: ['1999-1-x'],
      }).reasons[0]!.code,
    ).toBe('pick');

    handleCommand(state, { kind: 'sim.advance', days: 300 }, local, ctx);
    const summer = handleCommand(state, { kind: 'offseason.openFreeAgency' }, local, ctx);
    if (!summer.ok) throw new Error(summer.error.message);
    const roundOne = summer.events.filter((e) => e.kind === 'player.drafted' && e.round === 1);
    const owners = roundOne.map((e) => (e.kind === 'player.drafted' ? e.player.teamId : null));
    expect(owners.filter((t) => t === partner).length).toBe(2);
    expect(owners).not.toContain(mine);
    handleCommand(state, { kind: 'season.rollover' }, local, ctx);
    expect(state.pickOwners[mineFirst]).toBeUndefined();
  });
});
