import { expect, it } from 'vitest';
import { formatMoney } from './money';

it('formats whole dollars as millions with two decimals, sign before the $', () => {
  expect([1_000_000, -500_000, 850_000, 20_800_000, 0].map(formatMoney)).toEqual([
    '$1.00M',
    '-$0.50M',
    '$0.85M',
    '$20.80M',
    '$0.00M',
  ]);
});
