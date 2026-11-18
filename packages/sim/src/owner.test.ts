import { describe, expect, it } from 'vitest';
import { createLeague, defaultContext, marketOf, ownerOf } from './index';

describe('owners and markets', () => {
  const teams = Object.values(createLeague(1, defaultContext()).teams);

  it('every team has an owner and a market in range, the same every time', () => {
    for (const t of teams) {
      const o = ownerOf(t);
      expect(o.name).toMatch(/^\S+ \S+$/);
      for (const v of [o.priority, o.patience]) expect(v >= 0 && v <= 1).toBe(true);
      expect(marketOf(t)).toBeGreaterThanOrEqual(0.65);
      expect(marketOf(t)).toBeLessThanOrEqual(1.75);
      expect(ownerOf(t)).toEqual(o);
    }
  });

  it('teams differ', () => {
    expect(new Set(teams.map((t) => marketOf(t))).size).toBeGreaterThan(teams.length / 2);
    expect(new Set(teams.map((t) => ownerOf(t).name)).size).toBeGreaterThan(teams.length / 2);
  });
});
