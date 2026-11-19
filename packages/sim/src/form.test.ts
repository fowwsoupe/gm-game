import { describe, expect, it } from 'vitest';
import type { LeagueEvent, TeamId } from '@gm/shared';
import { createLeague, defaultContext, emitter, strengthFor } from './index';
import { rolloverSeason } from './offseason';

const base = defaultContext();
const ctx = { ...base, ruleset: { ...base.ruleset, season: { ...base.ruleset.season, form: 3 } } };

describe('season form', () => {
  it('each team draws a fresh form every season and plays it in every game', () => {
    const state = createLeague(1, ctx);
    const ids = Object.keys(state.teams).sort() as TeamId[];
    const first = { ...state.teamForm };
    rolloverSeason(state, ctx, emitter(state, [] as LeagueEvent[]));
    const second = state.teamForm;
    expect(Object.keys(second).sort()).toEqual(ids);
    expect(ids.some((id) => first[id] !== second[id])).toBe(true);
    const all = [...Object.values(first), ...Object.values(second)];
    const sd = Math.sqrt(all.reduce((s, f) => s + f * f, 0) / all.length);
    expect(sd).toBeGreaterThan(1.5);
    expect(sd).toBeLessThan(4.5);

    const id = ids[0]!;
    const players = Object.values(state.players).filter((p) => p.teamId === id);
    const strength = (form: number) => {
      state.teamForm[id] = form;
      return strengthFor(state, ctx, id, players) as { offense: number; defense: number };
    };
    const [hot, cold] = [strength(2), strength(-2)];
    expect(hot.offense - cold.offense).toBeCloseTo(4);
    expect(hot.defense - cold.defense).toBeCloseTo(4);
  });
});
