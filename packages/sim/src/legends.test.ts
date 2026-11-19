import { describe, expect, it } from 'vitest';
import { defaultContext, legendTrophies } from './index';

describe('awards named after legends', () => {
  it('the first inducted legend per award lends his surname, from the season after he retired', () => {
    const t = legendTrophies(
      [
        { name: 'Bo Later', position: 'C', retiredSeason: 9 },
        { name: 'Al Early Jr', position: 'W', retiredSeason: 4 },
        { name: 'Gus Stopper', position: 'G', retiredSeason: 6 },
        { name: 'Dan Blue', position: 'D', retiredSeason: 6 },
      ],
      defaultContext(),
    );
    expect(t).toEqual({
      mvp: { surname: 'Early Jr', from: 5 },
      topGoalie: { surname: 'Stopper', from: 7 },
      topDefender: { surname: 'Blue', from: 7 },
    });
    expect(legendTrophies([], defaultContext())).toEqual({});
  });
});
