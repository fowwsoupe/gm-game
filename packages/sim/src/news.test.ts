import { describe, expect, it } from 'vitest';
import type { Actor, Command, LeagueEvent } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, type LeagueState } from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };
const cal = ctx.ruleset.season.calendar;

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

describe('news posts', () => {
  it('every post that names a player carries his id, so the feed shows his face', () => {
    const state = createLeague(3, ctx);
    const events: LeagueEvent[] = [
      ...run(state, { kind: 'sim.advance', days: cal.regularSeasonDays + cal.playoffDays }),
      ...run(state, { kind: 'season.rollover' }),
    ];
    const about = events.filter((e) => e.kind === 'news.posted' && e.params?.player);
    expect(about.length).toBeGreaterThan(10);
    for (const e of about) {
      if (e.kind !== 'news.posted') continue;
      expect(e.playerId, e.headline).toBeDefined();
      const p = state.players[e.playerId!]; // gone if he retired at the rollover
      if (p) expect(`${p.firstName} ${p.lastName}`).toBe(e.params!.player);
    }
  });
});
