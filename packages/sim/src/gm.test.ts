import { describe, expect, it } from 'vitest';
import type { Team } from '@gm/shared';
import {
  choosePlan,
  createLeague,
  defaultContext,
  gmOf,
  misread,
  planStatus,
  seenBy,
} from './index';

const ctx = defaultContext();

describe('AI GMs', () => {
  it('every new team gets a GM, and leagues from different seeds differ', () => {
    const a = Object.values(createLeague(1, ctx).teams);
    const b = Object.values(createLeague(2, ctx).teams);
    expect(a.every((t) => t.gm && t.gm.skill >= 0 && t.gm.skill <= 1)).toBe(true);
    expect(a.map((t) => JSON.stringify(t.gm))).not.toEqual(b.map((t) => JSON.stringify(t.gm)));
  });

  it('a team without a stored GM gets the same one every time', () => {
    const team = {
      id: 't1',
      city: 'A',
      name: 'B',
      abbreviation: 'AB',
      userControlled: false,
    } as Team;
    expect(gmOf(team)).toEqual(gmOf(team));
  });

  it('every GM has a name: drawn when hired, the same on a replay, derived for an old save', () => {
    const names = () => Object.values(createLeague(1, ctx).teams).map((t) => t.gm?.name);
    expect(names().every(Boolean)).toBe(true);
    expect(names()).toEqual(names());
    const old = {
      id: 't1',
      city: 'A',
      name: 'B',
      abbreviation: 'AB',
      userControlled: false,
      gm: { style: 'balanced', skill: 0.5 },
    } as Team;
    expect(gmOf(old).name).toBeTruthy();
    expect(gmOf(old)).toEqual(gmOf(old));
    expect(gmOf(old).skill).toBe(0.5);
  });

  it('a better GM misreads players by less, and always the same way', () => {
    const spread = (skill: number) => {
      const reads = Array.from({ length: 400 }, (_, i) =>
        misread({ style: 'balanced', skill }, 't1' as Team['id'], `p${i}`),
      );
      return Math.sqrt(reads.reduce((s, x) => s + x * x, 0) / reads.length);
    };
    expect(spread(1)).toBeLessThan(1.3);
    expect(spread(0)).toBeGreaterThan(5);
    const gm = { style: 'balanced', skill: 0.3 } as const;
    expect(misread(gm, 't1' as Team['id'], 'p1')).toBe(misread(gm, 't1' as Team['id'], 'p1'));
    // A new GM at the same team has blind spots of his own, not his predecessor's.
    const next = { style: 'winNow', skill: 0.3 } as const;
    const same = Array.from({ length: 100 }, (_, i) => `p${i}`).filter(
      (id) =>
        Math.sign(misread(gm, 't1' as Team['id'], id)) ===
        Math.sign(misread(next, 't1' as Team['id'], id)),
    );
    expect(same.length).toBeLessThan(80);
  });

  it('seenBy shifts ratings and potential, never the real player', () => {
    const state = createLeague(3, ctx);
    const team = Object.values(state.teams)[0]!;
    const player = Object.values(state.players).find((p) => p.teamId === team.id)!;
    const before = JSON.stringify(player);
    const seen = seenBy({ ...team, gm: { style: 'balanced', skill: 0 } }, player);
    expect(JSON.stringify(player)).toBe(before);
    expect(seen.potential).not.toBe(player.potential);
  });

  it('plans: a good young core contends, a weak old one rebuilds, a rebuild gets 2-4 seasons', () => {
    const plan = (
      coreZ: number,
      coreAge: number,
      current?: { kind: 'rebuild' | 'contend'; since: number },
    ) => choosePlan({ coreZ, coreAge, style: 'balanced', current, season: 2030 });
    expect(plan(1.2, 26)).toBe('contend');
    expect(plan(-1.2, 30)).toBe('rebuild');
    expect(plan(0, 27)).toBe('retool');
    // A good core that has aged closes the window.
    expect(plan(0.8, 33)).not.toBe('contend');
    // A rebuild is not abandoned after one season, and ends after four.
    expect(plan(0.4, 24, { kind: 'rebuild', since: 2029 })).toBe('rebuild');
    expect(plan(-2, 30, { kind: 'rebuild', since: 2026 })).toBe('retool');
    // A contender holds on a little longer than it would start.
    expect(plan(0.35, 28, { kind: 'contend', since: 2028 })).toBe('contend');
    expect(plan(0.35, 28)).toBe('retool');
  });

  it('planStatus: a rebuilder sells while winning, a contender buys through a slump, humans unaffected', () => {
    const team = {
      id: 't1',
      city: 'A',
      name: 'B',
      abbreviation: 'AB',
      userControlled: false,
    } as Team;
    expect(planStatus({ ...team, plan: { kind: 'rebuild', since: 2030 } }, 'buyer')).toBe(
      'rebuilder',
    );
    expect(planStatus({ ...team, plan: { kind: 'contend', since: 2030 } }, 'seller')).toBe('buyer');
    expect(planStatus({ ...team, plan: { kind: 'retool', since: 2030 } }, 'seller')).toBe('seller');
    expect(
      planStatus(
        { ...team, userControlled: true, plan: { kind: 'rebuild', since: 2030 } },
        'buyer',
      ),
    ).toBe('buyer');
  });
});
