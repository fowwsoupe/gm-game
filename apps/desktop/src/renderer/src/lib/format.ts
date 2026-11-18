import { formatMoney, type Team } from '@gm/shared';

/** Whole dollars as $X.XXM (-$0.50M when negative). */
export const money = formatMoney;

/** Message params with `amount` (whole dollars) formatted as money. */
export const moneyParams = (params: Record<string, string | number> = {}) =>
  typeof params.amount === 'number' ? { ...params, amount: money(params.amount) } : params;

/** A stat value for display: save % as .912, everything else as is. */
export const statValue = (key: string, v: number) =>
  key === 'savePct' ? v.toFixed(3).replace(/^0/, '') : String(v);

/** A 0–1 share as a whole percent: 0.456 → 46%. */
export const pct = (n: number) => `${Math.round(n * 100)}%`;

/** A team's full name ("Boston Bruins"), or the id if the team is unknown. */
export const teamName = (teams: readonly Team[], id: string) => {
  const team = teams.find((x) => x.id === id);
  return team ? `${team.city} ${team.name}` : id;
};

export const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`;
