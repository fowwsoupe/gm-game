import { describe, expect, it } from 'vitest';
import type { Actor, Command } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, type LeagueState } from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

describe('teams in crisis', () => {
  it('a losing team whose owner has lost faith is in crisis; a winning one never', () => {
    const state = createLeague(4, ctx);
    run(state, { kind: 'sim.advance', days: 1 }); // the preseason meeting
    for (const o of Object.values(state.owners)) o.confidence = 10;
    run(state, { kind: 'sim.advance', days: 60 });
    const statuses = Object.values(state.teamStatus);
    expect(statuses).toContain('crisis');
    expect(statuses).not.toContain('seller');
    expect(statuses).not.toContain('rebuilder');
    expect(statuses).toContain('contender');
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    expect(state.teamStatus[mine]).not.toBe('crisis');
  });
});
