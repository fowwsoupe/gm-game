/**
 * Money is always integer dollars. Never floats: 0.1 + 0.2 !== 0.3, and cap math must be exact.
 */
export type Dollars = number;

export const dollars = (millions: number): Dollars => Math.round(millions * 1_000_000);

/** Percentage of an amount, rounded down to whole dollars. */
export const pct = (amount: Dollars, percent: number): Dollars =>
  Math.floor((amount * percent) / 100);

export function formatDollars(amount: Dollars): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000)
    return `${sign}$${(abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${abs}`;
}
