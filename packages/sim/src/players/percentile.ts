/**
 * Percentile of `value` within `population` (0–100), the basis of the "no overall rating"
 * player cards. Ties count half, so equal players share a percentile.
 */
export function percentileRank(value: number, population: readonly number[]): number {
  if (population.length === 0) return 50;
  let below = 0;
  let equal = 0;
  for (const p of population) {
    if (p < value) below++;
    else if (p === value) equal++;
  }
  return Math.round(((below + equal / 2) / population.length) * 100);
}
