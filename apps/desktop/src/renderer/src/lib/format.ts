/** Whole dollars as $X.XXM. */
export const money = (n: number) => `$${(n / 1e6).toFixed(2)}M`;

/** A stat value for display: save % as .912, everything else as is. */
export const statValue = (key: string, v: number) =>
  key === 'savePct' ? v.toFixed(3).replace(/^0/, '') : String(v);
