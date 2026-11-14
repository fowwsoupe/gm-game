import { describe, expect, it } from 'vitest';
import type { Actor, LeagueEvent, TeamId } from '@gm/shared';
import {
  applyEvent,
  computeStandings,
  createLeague,
  defaultContext,
  elcYears,
  handleCommand,
  NHL_2026,
  percentileRank,
  Rng,
  validateContract,
  dollars,
  type LeagueState,
} from './index';

const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();

function simSeason(seed: number) {
  const state = createLeague(seed, ctx);
  const res = handleCommand(state, { kind: 'sim.advance', days: 200 }, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return { state, events: res.events };
}

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
  });

  it('forks into independent streams', () => {
    const r = new Rng(1);
    expect(r.fork('a').next()).not.toEqual(r.fork('b').next());
  });
});

describe('season sim', () => {
  it('is fully deterministic for the same seed', () => {
    expect(simSeason(7).events).toEqual(simSeason(7).events);
  });

  it('plays every scheduled game, with a winner each time', () => {
    const { state } = simSeason(3);
    const results = Object.values(state.results);
    expect(results.length).toBe(state.schedule.length);
    for (const g of results) expect(g.homeScore).not.toEqual(g.awayScore);
  });

  it('gives each team the ruleset number of games', () => {
    const { state } = simSeason(5);
    const rows = computeStandings(
      Object.keys(state.teams) as TeamId[],
      Object.values(state.results),
    );
    for (const r of rows) expect(r.gp).toBe(NHL_2026.season.gamesPerTeam);
  });

  it('scoring lands in a realistic NHL range', () => {
    const results = Object.values(simSeason(11).state.results);
    const perTeam =
      results.reduce((s, g) => s + g.homeScore + g.awayScore, 0) / (results.length * 2);
    expect(perTeam).toBeGreaterThan(2.5);
    expect(perTeam).toBeLessThan(3.8);
  });
});

describe('events and reducer', () => {
  it('a second copy that replays the events ends up identical', () => {
    const live = createLeague(9, ctx);
    const replica: LeagueState = structuredClone(live);
    const res = handleCommand(live, { kind: 'sim.advance', days: 30 }, local, ctx);
    if (!res.ok) throw new Error();
    res.events.forEach((e: LeagueEvent) => applyEvent(replica, e));
    expect(replica).toEqual(live);
  });

  it('event ids are unique', () => {
    const ids = simSeason(2).events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects commands for teams a remote player does not control', () => {
    const state = createLeague(1, ctx);
    const team = Object.keys(state.teams)[0] as TeamId;
    const res = handleCommand(
      state,
      { kind: 'team.setUserControlled', teamId: team, userControlled: true },
      { id: 'remote-1', controls: [] },
      ctx,
    );
    expect(res.ok).toBe(false);
  });
});

describe('CBA rules', () => {
  it('validates contract length, minimum and maximum from the ruleset', () => {
    expect(
      validateContract(NHL_2026, {
        salaries: Array(7).fill(dollars(5)),
        signingAge: 27,
        isResign: true,
      }),
    ).toEqual([]);
    const tooLong = validateContract(NHL_2026, {
      salaries: Array(7).fill(dollars(5)),
      signingAge: 27,
      isResign: false,
    });
    expect(tooLong.map((i) => i.code)).toContain('too_long');
    const tooRich = validateContract(NHL_2026, {
      salaries: [dollars(25)],
      signingAge: 27,
      isResign: true,
    });
    expect(tooRich.map((i) => i.code)).toContain('above_maximum');
  });

  it('gives entry-level length by age', () => {
    expect(elcYears(NHL_2026, 18)).toBe(3);
    expect(elcYears(NHL_2026, 23)).toBe(2);
    expect(elcYears(NHL_2026, 30)).toBeNull();
  });
});

describe('players', () => {
  it('percentile ranks', () => {
    expect(percentileRank(90, [10, 20, 30, 90])).toBe(88);
    expect(percentileRank(5, [10, 20])).toBe(0);
  });
});
