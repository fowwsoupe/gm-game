/**
 * Whole dollars for display, always in millions with two decimals so table columns line up:
 * 1_000_000 → $1.00M, -500_000 → -$0.50M, 850_000 → $0.85M.
 */
export const formatMoney = (amount: number) =>
  `${amount < 0 ? '-' : ''}$${(Math.abs(amount) / 1e6).toFixed(2)}M`;
