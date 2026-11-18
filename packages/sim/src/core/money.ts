/**
 * Money is always integer dollars. Never floats: 0.1 + 0.2 !== 0.3, and cap math must be exact.
 */
export type Dollars = number;

export const dollars = (millions: number): Dollars => Math.round(millions * 1_000_000);

/** Percentage of an amount, rounded down to whole dollars. */
export const pct = (amount: Dollars, percent: number): Dollars =>
  Math.floor((amount * percent) / 100);

// Display formatting lives in @gm/shared (`formatMoney`), shared with the UI.
