import { describe, expect, it } from 'vitest';
import {
  coachOf,
  createLeague,
  defaultContext,
  DEPARTMENTS,
  marketOf,
  ownerOf,
  staffOf,
  staffSalary,
} from './index';

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

describe('front-office staff', () => {
  const ctx = defaultContext();
  const { salary } = ctx.ruleset.frontOffice;
  const teams = Object.values(createLeague(1, ctx).teams);

  it('every team has a head in each department, derived the same every time, paid by quality', () => {
    for (const t of teams) {
      for (const d of DEPARTMENTS) {
        const s = staffOf(t, d, salary, 2030);
        expect(s.name).toMatch(/^\S+ \S+$/);
        expect(s.quality >= 0 && s.quality <= 1).toBe(true);
        expect(s.hired).toBeLessThanOrEqual(2030);
        expect(s.salary).toBe(staffSalary(s.quality, salary));
        expect(staffOf(t, d, salary, 2030)).toEqual(s);
      }
      const q = coachOf(t, ctx.ruleset.finance.coach, 2030).quality!;
      expect(q >= 0 && q <= 1).toBe(true);
    }
    expect(staffSalary(0, salary)).toBe(salary.min);
    expect(staffSalary(1, salary)).toBe(salary.max);
  });

  it('a stored head is used as is', () => {
    const head = { name: 'A B', quality: 0.9, hired: 2027, salary: 1 };
    const t = { ...teams[0]!, staff: { medical: head } };
    expect(staffOf(t, 'medical', salary, 2030)).toBe(head);
  });
});
