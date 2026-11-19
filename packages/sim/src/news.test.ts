import { beforeAll, describe, expect, it } from 'vitest';
import type { Actor, Command, LeagueEvent } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  handleCommand,
  ownerOf,
  pairKey,
  storyOf,
  type LeagueState,
} from './index';

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
    state = createLeague(4, ctx);
    // Every pair of teams met in last season's playoffs, so every series is a rematch.
    const ids = Object.keys(state.teams) as (keyof typeof state.teams)[];
    for (const a of ids)
      for (const b of ids) state.playoffPairs[pairKey(a, b)] = state.date.season - 1;
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

  it("a rematch of last season's playoff series posts a rivalry renewed, one story a pair", () => {
    const series = events.flatMap((e) => (e.kind === 'series.started' ? [e] : []));
    const rivals = events.flatMap((e) =>
      e.kind === 'news.posted' && e.headline === 'event.rivalry' ? [e] : [],
    );
    expect(series.length).toBeGreaterThan(0);
    expect(rivals.map((e) => e.teamIds)).toEqual(
      series.map((e) => [e.series.higherTeamId, e.series.lowerTeamId]),
    );
    const stories = storyOf(events);
    for (const e of rivals)
      expect(stories[e.id]).toBe(`rivals:${pairKey(e.teamIds[0]!, e.teamIds[1]!)}`);
    // This season's pairs are kept for next season's playoffs.
    for (const e of series) {
      const { higherTeamId: a, lowerTeamId: b } = e.series;
      expect(state.playoffPairs[pairKey(a, b)]).toBe(e.date.season);
    }
  });
});
