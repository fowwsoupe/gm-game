import { describe, expect, it } from 'vitest';
import { morale, type MoraleInput } from './people';

const happy: MoraleInput = {
  teamStatus: 'contender',
  depthRank: 0,
  depth: 4,
  paidRatio: 1.2,
  seasons: 3,
  wantsOut: false,
};

describe('morale', () => {
  it('is higher on a winner, in a big role, well paid', () => {
    const sad: MoraleInput = {
      ...happy,
      teamStatus: 'crisis',
      depthRank: 6,
      paidRatio: 0.6,
      seasons: 0,
    };
    expect(morale('p1', happy).value).toBeGreaterThan(morale('p1', sad).value + 30);
  });

  it('is capped while he wants out, stays 0-100, and is the same every call', () => {
    expect(morale('p1', { ...happy, wantsOut: true }).value).toBeLessThanOrEqual(25);
    for (const id of ['a', 'b', 'c']) {
      const v = morale(id, happy).value;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
      expect(morale(id, happy)).toEqual(morale(id, happy));
    }
  });
});
