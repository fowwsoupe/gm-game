// Player profile data for the preview: attributes (1-20), role fit, scouting fog, staff words.
// Everything is derived from the mock Player, deterministically. Mock only; no sim involved.
import { ROSTER, byId, type Player, type Pos } from './mock';

/* ---------- players who are not on our roster (unscouted by default) ---------- */
const mk = (
  id: string,
  name: string,
  num: number,
  pos: Pos,
  age: number,
  ovr: number,
  capHit: number,
  years: number,
  traits: string[],
): Player => ({
  id,
  name,
  num,
  pos,
  line: 'X',
  age,
  ovr,
  capHit,
  years,
  status: 'OK',
  gp: 54,
  g: pos === 'D' ? 6 : 19,
  a: pos === 'D' ? 22 : 24,
  xgf: 52.1,
  toi: '17:40',
  ht: "6'0",
  shoots: 'L',
  traits,
});
export const TARGETS: Player[] = [
  mk('camden', 'Reid Camden', 91, 'LW', 26, 76, 4_100_000, 3, ['Sniper', 'Speed']),
  mk('greer', 'Pavel Greer', 55, 'D', 29, 72, 2_600_000, 3, ['Stay-at-home']),
  mk('ferland', 'Hugo Ferland', 88, 'C', 20, 66, 900_000, 3, ['Playmaker']),
  mk('lund', 'Kasper Lund', 64, 'D', 19, 68, 900_000, 3, ['Puck mover']),
];
export const lookup = (id: string): Player | undefined =>
  byId(id) ?? TARGETS.find((p) => p.id === id);
export const isOurs = (id: string): boolean => ROSTER.some((p) => p.id === id);

/* ---------- attributes ---------- */
export type Group = 'Skating' | 'Offence' | 'Defence' | 'Mental' | 'Physical';
export const GROUPS: Group[] = ['Skating', 'Offence', 'Defence', 'Mental', 'Physical'];
type Spec = [string, Group, number[]]; // name, group, bias per [skate, shoot, pass, defend, iq, phys]
const F_ATTR: Spec[] = [
  ['Speed', 'Skating', [3, 0, 0, 0, 0, 0]],
  ['Acceleration', 'Skating', [3, 0, 0, 0, 0, -1]],
  ['Shot', 'Offence', [0, 4, 0, -2, 0, 0]],
  ['Passing', 'Offence', [0, 0, 4, -1, 1, 0]],
  ['Puck skills', 'Offence', [1, 1, 2, -2, 0, 0]],
  ['Positioning', 'Defence', [0, -2, 0, 4, 1, 0]],
  ['Stick checking', 'Defence', [0, -2, 0, 3, 0, 0]],
  ['Hockey sense', 'Mental', [0, 0, 1, 1, 4, 0]],
  ['Composure', 'Mental', [0, 0, 0, 0, 3, 0]],
  ['Strength', 'Physical', [-1, 0, -1, 1, 0, 4]],
  ['Stamina', 'Physical', [1, 0, 0, 0, 0, 3]],
];
const D_ATTR: Spec[] = [
  ['Skating', 'Skating', [3, 0, 0, 0, 0, 0]],
  ['Pivots', 'Skating', [2, 0, 0, 1, 0, 0]],
  ['Point shot', 'Offence', [0, 3, 0, -2, 0, 0]],
  ['Outlet pass', 'Offence', [0, 0, 4, -1, 1, 0]],
  ['Gap control', 'Defence', [0, -2, 0, 4, 1, 0]],
  ['Shot blocking', 'Defence', [0, -2, 0, 3, 0, 1]],
  ['Hockey sense', 'Mental', [0, 0, 1, 1, 4, 0]],
  ['Composure', 'Mental', [0, 0, 0, 0, 3, 0]],
  ['Strength', 'Physical', [-1, 0, -1, 1, 0, 4]],
  ['Stamina', 'Physical', [1, 0, 0, 0, 0, 3]],
];
const G_ATTR: Spec[] = [
  ['Lateral', 'Skating', [3, 0, 0, 0, 0, 0]],
  ['Recovery', 'Skating', [2, 0, 0, 1, 0, 0]],
  ['Puck play', 'Offence', [0, 0, 3, 0, 0, 0]],
  ['Positioning', 'Defence', [0, 0, 0, 4, 1, 0]],
  ['Rebounds', 'Defence', [0, 0, 0, 3, 1, 0]],
  ['Reflexes', 'Defence', [1, 0, 0, 4, 0, 0]],
  ['Focus', 'Mental', [0, 0, 0, 0, 4, 0]],
  ['Composure', 'Mental', [0, 0, 0, 0, 3, 0]],
  ['Endurance', 'Physical', [0, 0, 0, 0, 0, 4]],
];
const specOf = (pos: Pos): Spec[] => (pos === 'D' ? D_ATTR : pos === 'G' ? G_ATTR : F_ATTR);

const seedOf = (s: string): number => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 7);
/** Position-typical shape: wingers shoot, centres pass, defencemen defend. */
const POS_BIAS: Record<Pos, number[]> = {
  C: [0, 0, 2, 1, 1, 0],
  LW: [1, 2, 0, -1, 0, 0],
  RW: [1, 2, 0, -1, 0, 0],
  D: [0, -1, 0, 2, 0, 1],
  G: [0, 0, 0, 2, 0, 0],
};
const clamp = (n: number): number => Math.max(3, Math.min(20, n));
function rawAttrs(pl: Player): { name: string; group: Group; v: number }[] {
  const seed = seedOf(pl.id);
  const base = (pl.ovr - 40) / 3; // 84 -> 14.7
  const agePenalty = pl.age > 30 ? (pl.age - 30) * 0.4 : 0;
  return specOf(pl.pos).map(([name, group, w], i) => {
    const shape = w.reduce((n, x, k) => n + x * 0.35 + (POS_BIAS[pl.pos][k] ?? 0) * 0.15, 0);
    const wob = ((seed >> (i % 7)) % 5) - 2;
    const old = group === 'Skating' || group === 'Physical' ? agePenalty : 0;
    return { name, group, v: clamp(Math.round(base + shape * 0.6 + wob * 0.7 - old)) };
  });
}

const mean = (a: number[]): number => (a.length ? a.reduce((n, x) => n + x, 0) / a.length : 0);
const kind = (p: Pos): 'F' | 'D' | 'G' => (p === 'D' ? 'D' : p === 'G' ? 'G' : 'F');
/** League-typical value of each attribute for this position group (the "average" every bar is judged against). */
const avgCache = new Map<string, number>();
function posAvg(pl: Player, name: string): number {
  const k = `${kind(pl.pos)}:${name}`;
  const hit = avgCache.get(k);
  if (hit !== undefined) return hit;
  const peers = ROSTER.filter((p) => kind(p.pos) === kind(pl.pos));
  const v = mean(peers.map((p) => rawAttrs(p).find((a) => a.name === name)?.v ?? 0));
  // Our roster is above league average; pull the benchmark down a little.
  const out = Math.round((v - 1.2) * 10) / 10;
  avgCache.set(k, out);
  return out;
}

/** Scouting level 0..3. Our own players are always fully known. */
export const FOG = [4, 2, 1, 0] as const;
export interface Attr {
  name: string;
  group: Group;
  v: number;
  lo: number;
  hi: number;
  avg: number;
  tone: 'up' | 'down' | 'flat';
}
export function attrsOf(pl: Player, level: number): Attr[] {
  const fog = FOG[Math.max(0, Math.min(3, level))]!;
  return rawAttrs(pl).map((a) => {
    const avg = posAvg(pl, a.name);
    const d = a.v - avg;
    // Fog is deterministic: the range is centred a little off the truth so it never gives it away.
    const shift = fog ? ((seedOf(pl.id + a.name) % (fog + 1)) - fog / 2) | 0 : 0;
    const lo = clamp(a.v - fog + shift);
    const hi = clamp(a.v + fog + shift);
    return {
      ...a,
      lo: Math.min(lo, a.v),
      hi: Math.max(hi, a.v),
      avg,
      tone: d >= 2 ? 'up' : d <= -2 ? 'down' : 'flat',
    };
  });
}
const grp = (as: Attr[], g: Group): number => mean(as.filter((a) => a.group === g).map((a) => a.v));

/* ---------- role fit ---------- */
interface Role {
  name: string;
  wt: Partial<Record<Group, number>>;
}
const ROLES: Record<Pos, Role[]> = {
  C: [
    { name: 'Two-way C', wt: { Offence: 1, Defence: 1, Mental: 1 } },
    { name: 'Playmaking C', wt: { Offence: 2, Mental: 1, Skating: 0.5 } },
    { name: 'Shutdown C', wt: { Defence: 2, Mental: 1, Physical: 1 } },
  ],
  LW: [
    { name: 'Sniper', wt: { Offence: 2, Skating: 1 } },
    { name: 'Two-way winger', wt: { Offence: 1, Defence: 1, Mental: 1 } },
    { name: 'Power forward', wt: { Physical: 2, Offence: 1 } },
  ],
  RW: [
    { name: 'Sniper', wt: { Offence: 2, Skating: 1 } },
    { name: 'Two-way winger', wt: { Offence: 1, Defence: 1, Mental: 1 } },
    { name: 'Power forward', wt: { Physical: 2, Offence: 1 } },
  ],
  D: [
    { name: 'PP quarterback', wt: { Offence: 2, Mental: 1, Skating: 1 } },
    { name: 'Shutdown D', wt: { Defence: 2, Physical: 1, Mental: 1 } },
    { name: 'Puck-moving D', wt: { Skating: 1, Offence: 1, Mental: 1 } },
  ],
  G: [
    { name: 'Starter', wt: { Defence: 2, Mental: 1, Skating: 1 } },
    { name: 'Tandem 1B', wt: { Defence: 1, Mental: 1 } },
  ],
};
export interface Fit {
  role: string;
  stars: number; // 1..5, half steps
}
export function fitsOf(pl: Player, level = 3): Fit[] {
  const as = attrsOf(pl, level);
  return ROLES[pl.pos]
    .map((r) => {
      const tw = Object.values(r.wt).reduce((n, x) => n + x, 0);
      const s = Object.entries(r.wt).reduce((n, [g, w]) => n + grp(as, g as Group) * w, 0) / tw;
      // 12 -> 2.5 stars, 16 -> 4, 18+ -> 5
      return {
        role: r.name,
        stars: Math.max(1, Math.min(5, Math.round(((s - 5) / 2.6) * 2) / 2)),
      };
    })
    .sort((a, b) => b.stars - a.stars);
}
/** Short tier label: what the player is, in hockey words. */
export function tierOf(pl: Player): string {
  const o = pl.ovr;
  if (pl.pos === 'G') return o >= 80 ? 'Starter' : o >= 72 ? 'Strong backup' : 'Backup';
  if (pl.pos === 'D') return o >= 82 ? 'Top-pair D' : o >= 74 ? 'Second-pair D' : 'Third-pair D';
  const p = pl.pos === 'C' ? 'C' : 'W';
  return o >= 84
    ? `First-line ${p}`
    : o >= 77
      ? `Second-line ${p}`
      : o >= 70
        ? `Third-line ${p}`
        : `Depth ${p}`;
}
export const stars = (n: number): string =>
  '★'.repeat(Math.floor(n)) + (n % 1 ? '½' : '') + '☆'.repeat(5 - Math.ceil(n));

/* ---------- potential is always a range ---------- */
export function potential(pl: Player, level: number): [number, number] {
  const room = pl.age <= 21 ? 10 : pl.age <= 24 ? 6 : pl.age <= 28 ? 2 : 0;
  const fog = FOG[Math.max(0, Math.min(3, level))]! * 1.5;
  const mid = pl.ovr + room / 2;
  return [Math.round(Math.max(pl.ovr, mid - room / 2 - fog)), Math.round(mid + room / 2 + fog)];
}

/* ---------- contract value ---------- */
export function contractValue(pl: Player): { fair: number; delta: number; word: string } {
  const fair = Math.round(Math.max(0.775, (pl.ovr - 60) * 0.42) * 1e6);
  const delta = fair - pl.capHit; // positive: underpaid
  const word =
    Math.abs(delta) < 700_000
      ? 'Fair deal'
      : delta > 0
        ? `Underpaid by $${(delta / 1e6).toFixed(1)}M`
        : `Overpaid by $${(-delta / 1e6).toFixed(1)}M`;
  return { fair, delta, word };
}

/* ---------- staff opinions, in plain words ---------- */
export function staffOf(pl: Player, level: number): { who: string; says: string }[] {
  const as = attrsOf(pl, 3);
  const top = [...as].sort((a, b) => b.v - b.avg - (a.v - a.avg))[0]!;
  const low = [...as].sort((a, b) => a.v - a.avg - (b.v - b.avg))[0]!;
  const best = fitsOf(pl)[0]!;
  const tier = tierOf(pl).toLowerCase();
  const skating = grp(as, 'Skating') < (posAvg(pl, as[0]!.name) || 0) + 1;
  const trend = pl.age >= 31 ? ', declining skating' : pl.age <= 22 ? ', still growing' : '';
  const scout =
    level < 2
      ? `We have only seen him a handful of times. Looks like a ${tier} with ${top.name.toLowerCase()} as his calling card. Send a scout before you commit.`
      : `A reliable ${tier}${trend}. Best fit: ${best.role.toLowerCase()}. Weakest area: ${low.name.toLowerCase()}.`;
  const cv = contractValue(pl);
  return [
    { who: 'Chief scout', says: scout },
    {
      who: 'Coach',
      says:
        pl.status !== 'OK'
          ? `Hurt. ${pl.note ?? 'Hold him back a few days.'}`
          : pl.traits.length
            ? `${pl.traits.join(' and ')}. ${skating ? 'Wish he were quicker.' : 'Plays his minutes without fuss.'}`
            : 'Does the job.',
    },
    {
      who: 'Cap manager',
      says: `${cv.word}. ${pl.years === 1 ? 'Expires in June.' : `Signed for ${pl.years} more years.`}`,
    },
  ];
}

/* ---------- career line (mock): last three seasons ---------- */
export function careerOf(pl: Player): { yr: string; gp: number; g: number; a: number }[] {
  const s = seedOf(pl.id);
  return [2, 1, 0].map((back) => {
    const f = 1 - back * 0.12 + ((s >> back) % 7) / 100;
    return {
      yr: `${2024 - back + 1}–${String(2025 - back + 1).slice(-2)}`,
      gp: Math.min(82, Math.round(pl.gp * 1.4 * (back === 0 ? 1 : 1.05))),
      g: Math.round(pl.g * 1.4 * f),
      a: Math.round(pl.a * 1.4 * f),
    };
  });
}

/* ---------- exceptions only: what a tile flags ---------- */
export function flagOf(pl: Player): { tone: 'bad' | 'warn' | 'good'; text: string } | null {
  if (pl.status === 'IR') return { tone: 'bad', text: 'Injured' };
  if (pl.status === 'DTD') return { tone: 'warn', text: 'Day to day' };
  if (pl.pos !== 'G' && pl.xgf > 0 && pl.xgf < 46.5) return { tone: 'bad', text: 'Slumping' };
  if (pl.years === 1 && pl.ovr >= 75) return { tone: 'warn', text: 'Contract year' };
  return null;
}

/* ---------- trade impact ---------- */
const CHAIN = ['F1', 'F2', 'F3', 'F4', 'D1', 'D2', 'D3'];
export interface Impact {
  moves: string[]; // "Pelletier up to Line 2"
  thin: string | null; // position that is left short
  lineDelta: { line: string; from: number; to: number } | null;
}
const LN: Record<string, string> = {
  F1: 'Line 1',
  F2: 'Line 2',
  F3: 'Line 3',
  F4: 'Line 4',
  D1: 'Pair 1',
  D2: 'Pair 2',
  D3: 'Pair 3',
};
export function impactOf(pl: Player, roster: Player[], incoming: Player[]): Impact {
  if (!CHAIN.includes(pl.line)) return { moves: [], thin: null, lineDelta: null };
  const same = roster
    .filter((p) => p.pos === pl.pos && p.id !== pl.id && CHAIN.includes(p.line))
    .sort((a, b) => CHAIN.indexOf(a.line) - CHAIN.indexOf(b.line));
  const below = same.filter((p) => CHAIN.indexOf(p.line) > CHAIN.indexOf(pl.line));
  const incomers = incoming.filter((p) => p.pos === pl.pos);
  const scratch = roster.find((p) => p.line === 'X' && p.pos === pl.pos && p.id !== pl.id);
  const moves = below.map(
    (p, i) => `${p.name.split(' ')[1]} up to ${LN[i === 0 ? pl.line : below[i - 1]!.line]}`,
  );
  const filler = incomers[0] ?? scratch;
  if (filler && below.length)
    moves.push(`${filler.name.split(' ')[1]} joins ${LN[below[below.length - 1]!.line]}`);
  else if (filler) moves.push(`${filler.name.split(' ')[1]} takes his spot`);
  const rate = (l: string, drop: boolean) => {
    const ps = roster.filter((p) => p.line === l && (!drop || p.id !== pl.id));
    return ps.length ? ps.reduce((n, p) => n + p.ovr, 0) / ps.length : 0;
  };
  const after = below[0] ?? filler;
  const to = after
    ? (rate(pl.line, true) * (roster.filter((p) => p.line === pl.line).length - 1) + after.ovr) /
      roster.filter((p) => p.line === pl.line).length
    : 0;
  return {
    moves,
    thin: filler ? null : pl.pos,
    lineDelta: { line: LN[pl.line]!, from: Math.round(rate(pl.line, false)), to: Math.round(to) },
  };
}
/** Salary that still counts next season (expiring deals fall off). */
export const nextYearCap = (p: Player): number => (p.years > 1 ? p.capHit : 0);

/** Trade asset id -> the player it brings back (picks have none). */
export const ASSET_PLAYER: Record<string, string> = {
  o4: 'lund',
  o5: 'ferland',
  o6: 'camden',
  o7: 'greer',
};
