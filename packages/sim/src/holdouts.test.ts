import { describe, expect, it } from 'vitest';
import type { Actor, Command } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  handleCommand,
  personalityOf,
  talkedRound,
  type LeagueState,
} from './index';

const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

/** A league where every player on my team is badly underpaid, played to the first game. */
function atStart(seed: number) {
  const state = createLeague(seed, ctx);
  const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
  for (const p of Object.values(state.players)) {
    if (p.teamId === mine && p.contract) p.contract.capHit = ctx.ruleset.cap.minSalary;
  }
  const events = run(state, {
    kind: 'sim.advance',
    days: 1,
  });
  return { state, mine, events };
}

describe('holdouts', () => {
  it('an underpaid, greedy core player may refuse to report, and then sits out', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { state, mine } = atStart(seed);
      if (state.holdouts.length === 0) continue;
      expect(state.holdouts).toHaveLength(1);
      const { playerId, teamId } = state.holdouts[0]!;
      expect(teamId).toBe(mine);
      expect(personalityOf(playerId).greed).toBeGreaterThanOrEqual(0.6);
      // A talk works exactly when who he is says so; otherwise he gives up within the season.
      run(state, { kind: 'holdout.talk', playerId });
      expect(state.holdouts.length === 0).toBe(talkedRound(playerId));
      run(state, { kind: 'sim.advance', days: 100 });
      expect(state.holdouts).toHaveLength(0);
      return;
    }
    throw new Error('no holdout in 40 seeds');
  });

  it('the AI teams never hold out', () => {
    const { state, mine } = atStart(3);
    expect(state.holdouts.every((h) => h.teamId === mine)).toBe(true);
  });
});
