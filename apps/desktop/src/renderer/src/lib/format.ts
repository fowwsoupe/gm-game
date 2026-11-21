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

/**
 * A team's two colours, derived from its id until a roster file can set them (so there is no
 * colour table here): a mid-tone that reads on the dark ice, and a pale one from across the wheel.
 */
export const teamColors = (id: string) => {
  let h = 0;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 0x9e3779b1);
  const hue = ((h ^ (h >>> 15)) >>> 0) % 360;
  return {
    hue,
    primary: `hsl(${hue} 70% 55%)`,
    secondary: `hsl(${(hue + 180) % 360} 35% 85%)`,
  };
};

/** What two sides wear, [home, away]: the away side its secondary when the two primaries are close. */
export const sideColors = (homeId: string, awayId: string): [string, string] => {
  const home = teamColors(homeId);
  const away = teamColors(awayId);
  const gap = Math.abs(home.hue - away.hue);
  return [home.primary, Math.min(gap, 360 - gap) < 40 ? away.secondary : away.primary];
};

/** Time left in the period; overtime is one 20:00 period at a time in the playoffs, shorter otherwise. */
export const clockText = (sec: number, ot: number) => {
  const left = Math.max(0, sec < 3600 ? 1200 - (sec % 1200) : ot - ((sec - 3600) % ot));
  return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
};

/** A pick id (`2028-1-t3`) as `trade.pick` params: draft season, round, original team. */
export const pickParams = (teams: readonly Team[], id: string) => {
  const [season = '', round = '', ...team] = id.split('-');
  const original = team.join('-');
  return { season, round, team: teamAbbr(teams, original, original) };
};

export const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`;
