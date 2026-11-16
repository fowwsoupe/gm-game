import { describe, expect, it } from 'vitest';
import type { Team } from '@gm/shared';
import { createLeague, defaultContext, gmOf, misread, seenBy } from './index';

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
});
