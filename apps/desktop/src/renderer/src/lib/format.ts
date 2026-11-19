import { formatMoney, type LowerLeagueLine, type Team } from '@gm/shared';

/** Whole dollars as $X.XXM (-$0.50M when negative). */
export const money = formatMoney;

/** Staff quality (0-1) as a word: the number stays hidden, like player ratings. */
export const qualityKey = (q: number) =>
  q < 0.25
    ? ('staff.quality.poor' as const)
    : q < 0.6
      ? ('staff.quality.average' as const)
      : q < 0.85
        ? ('staff.quality.good' as const)
        : ('staff.quality.elite' as const);

/** Message params with `amount` (whole dollars) formatted as money. */
export const moneyParams = (params: Record<string, string | number> = {}) =>
  typeof params.amount === 'number' ? { ...params, amount: money(params.amount) } : params;

/** A stat value for display: save % as .912, everything else as is. */
export const statValue = (key: string, v: number) =>
  key === 'savePct' ? v.toFixed(3).replace(/^0/, '') : String(v);

/** A lower-league season in a few numbers: "Junior · 64 GP · 41 PTS" (goalies: save %). */
export const leagueLineText = (line: LowerLeagueLine, label: (key: string) => string) =>
  [
    label(`league.${line.league}`),
    ...['gp', 'points', 'savePct']
      .filter((k) => line.stats[k] !== undefined)
      .map((k) => `${statValue(k, line.stats[k]!)} ${label(`stat.${k}`)}`),
  ].join(' · ');

/** A 0–1 share as a whole percent: 0.456 → 46%. */
export const pct = (n: number) => `${Math.round(n * 100)}%`;

/** A team's full name ("Boston Bruins"), or the id if the team is unknown. */
export const teamName = (teams: readonly Team[], id: string) => {
  const team = teams.find((x) => x.id === id);
  return team ? `${team.city} ${team.name}` : id;
};

/** A team's abbreviation ("BOS"), or `fallback` if the team is unknown. */
export const teamAbbr = (teams: readonly Team[], id: string | null, fallback = '') =>
  teams.find((x) => x.id === id)?.abbreviation ?? fallback;

/** A pick id (`2028-1-t3`) as `trade.pick` params: draft season, round, original team. */
export const pickParams = (teams: readonly Team[], id: string) => {
  const [season = '', round = '', ...team] = id.split('-');
  const original = team.join('-');
  return { season, round, team: teamAbbr(teams, original, original) };
};

export const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`;
