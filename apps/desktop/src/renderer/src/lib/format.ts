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

/** A colour as hue (degrees), saturation and lightness (percent). */
type Hsl = readonly [number, number, number];

/** `#rrggbb` as hue, saturation and lightness. */
const hsl = (hex: string): Hsl => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const l = max - d / 2;
  const h = !d ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, d ? (100 * d) / (1 - Math.abs(2 * l - 1)) : 0, 100 * l];
};

/**
 * A team's two colours: the roster file's (`Team.colors`), else derived from its id (so there is
 * no colour table here): a mid-tone and a pale one from across the wheel. The ice is dark, so a
 * file's navy or black keeps its hue and is lifted to the lightness the derived ones have.
 */
export const teamColors = (team: { id: string; colors?: Team['colors'] }) => {
  if (team.colors) {
    const lift = ([h, s, l]: Hsl): Hsl => [h, s, Math.max(l, 55)];
    return { primary: lift(hsl(team.colors.primary)), secondary: lift(hsl(team.colors.secondary)) };
  }
  let h = 0;
  for (const c of team.id) h = Math.imul(h ^ c.charCodeAt(0), 0x9e3779b1);
  const hue = ((h ^ (h >>> 15)) >>> 0) % 360;
  return { primary: [hue, 70, 55] as Hsl, secondary: [(hue + 180) % 360, 35, 85] as Hsl };
};

/** How far apart two colours are, 0 to 2: the straight line between them in the HSL double cone. */
const apart = (a: Hsl, b: Hsl) => {
  const at = ([h, s, l]: Hsl) => {
    const chroma = (s / 100) * (1 - Math.abs(l / 50 - 1));
    return [
      chroma * Math.cos((h * Math.PI) / 180),
      chroma * Math.sin((h * Math.PI) / 180),
      l / 100,
    ];
  };
  const [p, q] = [at(a), at(b)];
  return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
};

/**
 * What two sides wear, [home, away], as CSS colours. The away side wears its secondary when its
 * primary is close to the home side's (0.43: two derived primaries 40 degrees apart on the wheel)
 * and its secondary is farther from it.
 */
export const sideColors = (
  teams: readonly Team[],
  homeId: string,
  awayId: string,
): [string, string] => {
  const [home, away] = [homeId, awayId].map((id) =>
    teamColors(teams.find((x) => x.id === id) ?? { id }),
  );
  const far = (c: Hsl) => apart(home!.primary, c);
  const worn =
    far(away!.primary) >= Math.min(0.43, far(away!.secondary)) ? away!.primary : away!.secondary;
  return [home!.primary, worn].map(
    ([h, s, l]) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`,
  ) as [string, string];
};

/** Seconds as m:ss. */
export const minSec = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

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
