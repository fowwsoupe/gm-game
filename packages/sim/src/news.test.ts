import { beforeAll, describe, expect, it } from 'vitest';
import type { Actor, Command, LeagueEvent } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, ownerOf, type LeagueState } from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };
const cal = ctx.ruleset.season.calendar;

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

describe('news posts', () => {
  let state: LeagueState;
  let events: LeagueEvent[];
  beforeAll(() => {
    state = createLeague(3, ctx);
    events = [
      ...run(state, { kind: 'sim.advance', days: cal.regularSeasonDays + cal.playoffDays }),
      ...run(state, { kind: 'season.rollover' }),
    ];
  });

  it('every post that names a player carries his id, so the feed shows his face', () => {
    const about = events.filter((e) => e.kind === 'news.posted' && e.params?.player);
    expect(about.length).toBeGreaterThan(10);
    for (const e of about) {
      if (e.kind !== 'news.posted') continue;
      expect(e.playerId, e.headline).toBeDefined();
      const p = state.players[e.playerId!]; // gone if he retired at the rollover
      if (p) expect(`${p.firstName} ${p.lastName}`).toBe(e.params!.player);
    }
  });

  it('front-office posts carry who speaks: the fired coach, the GM leaving, the owner', () => {
    const posts = events.flatMap((e) => (e.kind === 'news.posted' ? [e] : []));
    const coaches = posts.filter((e) => e.headline === 'event.coachFired');
    expect(coaches.length).toBeGreaterThan(0);
    for (const e of coaches) {
      expect(e.by).toEqual({ role: 'coach', name: e.params!.coach });
      expect(e.by!.name).not.toBe(e.params!.next); // his own name, not his successor's
    }
    const hires = events.flatMap((e) => (e.kind === 'team.gmChanged' ? [e] : []));
    const gms = posts.filter(
      (e) => e.headline === 'event.gmFired' || e.headline === 'event.gmLeft',
    );
    expect(gms.length).toBe(hires.length);
    expect(hires.length).toBeGreaterThan(0);
    for (const [i, e] of gms.entries()) {
      expect(hires[i]!.gm.name).toBeTruthy();
      expect(e.by?.role).toBe('gm');
      expect(e.by!.name).not.toBe(hires[i]!.gm.name);
    }
    for (const e of posts.filter((x) => x.headline === 'event.ownerFrustrated')) {
      expect(e.by).toEqual({ role: 'owner', name: ownerOf(state.teams[e.teamIds[0]!]!).name });
    }
  });
});
