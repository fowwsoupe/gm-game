// The one source of truth for the preview. Every screen reads facts derived here; nothing is typed twice.
// A Snap is the league as it stands on one date. Facts add what the GM has done since (games, trades, signings).
import {
  ATLANTIC,
  CAP,
  METRO,
  RESULT_TEXT,
  ROSTER,
  SCHEDULE,
  pts,
  type Ask,
  type Player,
  type Row,
  type Wire,
} from './mock';

export type Phase = 'regular' | 'opener' | 'deadline' | 'fa' | 'playoffs' | 'draft';
export type NeedId = 'agent' | 'offer' | 'goalie' | 'lineup';
export interface LNeed {
  id: NeedId;
  who: string;
  title: string;
  detail: string;
  due: string;
  pid: string;
}
export interface Game {
  opp: string;
  ab: string;
  home: boolean;
  when: string; // "Tonight · 7:00 PM"
  date: string; // "Thursday, February 12"
  res: [number, number, boolean];
  stars: string[];
  why: string;
  tag?: string; // "Game 5"
}
export interface Snap {
  phase: Phase;
  atl: Row[];
  metro: Row[];
  projAtl?: Row[]; // opener only: last season's pace as a projection
  stand: boolean; // do games move the standings
  games: Game[];
  dates: string[]; // used when there are no games (offseason days)
  needs: LNeed[];
  wire: Wire[];
  odds: number | null;
  offseason: boolean; // expired deals are UFAs, injuries cleared
  clock?: string; // deadline countdown
}
export type PRow = Row & { p: number };

/* ---------- standings by date ---------- */
const at = (rows: Row[], g: number): Row[] =>
  rows.map((r) => {
    const k = g / r.gp;
    const w = Math.round(r.w * k);
    const otl = Math.round(r.otl * k);
    return { ...r, gp: g, w, otl, l: g - w - otl };
  });
const zero = (rows: Row[]): Row[] => rows.map((r) => ({ ...r, gp: 0, w: 0, l: 0, otl: 0 }));
const FINAL = { atl: at(ATLANTIC, 82), metro: at(METRO, 82) };

/* ---------- games ---------- */
const g = (i: number, when: string, date: string): Game => {
  const s = SCHEDULE[i]!;
  const t = RESULT_TEXT[i]!;
  return { opp: s.opp, ab: s.ab, home: s.home, when, date, res: s.res, stars: t.stars, why: t.why };
};
const REG: Game[] = [
  g(0, 'Tonight · 7:00 PM', 'Friday, February 12'),
  g(1, 'Sunday · 7:00 PM', 'Sunday, February 14'),
  g(2, 'Tuesday · 7:30 PM', 'Tuesday, February 16'),
  g(3, 'Thursday · 7:00 PM', 'Thursday, February 18'),
  g(4, 'Saturday · 7:00 PM', 'Saturday, February 20'),
];
const OPEN: Game[] = [
  g(0, 'Tonight · 7:00 PM', 'Tuesday, October 6'),
  g(1, 'Thursday · 7:00 PM', 'Thursday, October 8'),
  g(2, 'Saturday · 7:00 PM', 'Saturday, October 10'),
  g(3, 'Tuesday · 7:00 PM', 'Tuesday, October 13'),
  g(4, 'Thursday · 7:00 PM', 'Thursday, October 15'),
];
const DEAD: Game[] = [
  g(2, 'Tonight · 7:00 PM', 'Friday, March 5'),
  g(3, 'Sunday · 7:00 PM', 'Sunday, March 7'),
  g(4, 'Wednesday · 7:00 PM', 'Wednesday, March 10'),
];

/* ---------- first round, derived from the final standings ---------- */
const rank = (rows: Row[]): PRow[] =>
  rows.map((r) => ({ ...r, p: pts(r) })).sort((a, b) => b.p - a.p || a.gp - b.gp);
const A = rank(FINAL.atl);
const M = rank(FINAL.metro);
export interface Series {
  a: PRow;
  b: PRow; // a is the higher seed and has home ice
  sa: number;
  sb: number;
  me: boolean;
}
// Division format: 1 plays the other conference's wild card, 2 plays 3.
const PAIRS: [PRow, PRow][] = [
  [A[0]!, M[3]!],
  [A[1]!, A[2]!],
  [M[0]!, A[3]!],
  [M[1]!, M[2]!],
];
const OTHER_SCORES: [number, number][] = [
  [3, 1],
  [2, 2],
  [1, 3],
  [2, 1],
];
const myPair = PAIRS.findIndex(([a, b]) => a.ab === 'MTL' || b.ab === 'MTL');
const mePair = PAIRS[myPair]!;
const homeIce = mePair[0].ab === 'MTL';
const OPP = homeIce ? mePair[1] : mePair[0];
export const SERIES_BASE: Series[] = PAIRS.map(([a, b], i) => ({
  a,
  b,
  sa: i === myPair ? 2 : OTHER_SCORES[i]![0],
  sb: i === myPair ? 2 : OTHER_SCORES[i]![1],
  me: i === myPair,
}));
const po = (
  n: number,
  home: boolean,
  when: string,
  date: string,
  res: [number, number, boolean],
  why: string,
  stars: string[],
): Game => ({
  opp: OPP.name,
  ab: OPP.ab,
  home,
  when,
  date,
  res,
  why,
  stars,
  tag: `Game ${n}`,
});
const PO: Game[] = [
  po(
    5,
    homeIce,
    'Tonight · 7:30 PM',
    'Monday, April 26',
    [3, 2, false],
    'Lindqvist scored the winner with four minutes left on a power play.',
    ['Lindqvist, 1 G 1 A', 'Vuorinen, 29 saves', 'Rochefort, 1 G'],
  ),
  po(
    6,
    !homeIce,
    'Wednesday · 7:30 PM',
    'Wednesday, April 28',
    [2, 3, false],
    'Two goals against in the first ten minutes. Montréal outshot them 34–22 and could not finish.',
    [`${OPP.name} G, 32 saves`, 'Tallström, 1 G', `${OPP.name} C, 2 G`],
  ),
  po(
    7,
    homeIce,
    'Friday · 7:30 PM',
    'Friday, April 30',
    [4, 1, false],
    'Montréal scored first and the building did the rest. The series is won.',
    ['Brisebois, 2 G', 'Vuorinen, 25 saves', 'Lindqvist, 2 A'],
  ),
];

/* ---------- needs ---------- */
const N = {
  agent: (title: string, detail: string, due: string): LNeed => ({
    id: 'agent',
    who: 'Dana Kessler · agent',
    title,
    detail,
    due,
    pid: 'brisebois',
  }),
  offer: (due: string): LNeed => ({
    id: 'offer',
    who: 'Ottawa',
    title: '2027 1st and a D prospect for Calvin Marsh',
    detail: 'Marsh is 29, $6.00M through 2029. Taking it frees $6.00M of cap space.',
    due,
    pid: 'marsh',
  }),
  goalie: (due: string, title: string): LNeed => ({
    id: 'goalie',
    who: 'Medical',
    title,
    detail: 'He practised in a no-contact jersey. Fontaine is 0.903 SV%, 14 starts.',
    due,
    pid: 'vuorinen',
  }),
  lineup: (title: string, detail: string, due: string): LNeed => ({
    id: 'lineup',
    who: 'Coaching staff',
    title,
    detail,
    due,
    pid: 'hruby',
  }),
};

/* ---------- wire ---------- */
const W = (
  id: string,
  at: string,
  team: string,
  text: string,
  cause: string,
  you?: string,
  go?: Wire['go'],
): Wire => {
  const w: Wire = { id, at, team, text, cause };
  if (you) w.you = you;
  if (go) w.go = go;
  return w;
};

export const SNAPS: Record<Phase, Snap> = {
  opener: {
    phase: 'opener',
    atl: zero(ATLANTIC),
    metro: zero(METRO),
    projAtl: FINAL.atl,
    stand: true,
    games: OPEN,
    dates: [],
    odds: null,
    offseason: false,
    needs: [
      N.lineup(
        'Set the opening-night lines',
        'Hrubý is back from his summer surgery. Coach Dufour wants him on line 2.',
        'Before 7:00 PM',
      ),
      N.goalie('Before 7:00 PM', 'Vuorinen is day to day (lower body)'),
    ],
    wire: [
      W(
        'o1',
        'Oct 5',
        'TOR',
        'signed C Mats Dahlin to 3 years, $6.40M',
        'Replaces the centre who left in free agency',
        'Your opening-night opponent',
        { label: 'League', target: 'league' },
      ),
      W('o2', 'Oct 4', 'BOS', 'named D Anselm Roy captain', 'First captain change in nine years'),
      W(
        'o3',
        'Oct 3',
        'FLA',
        'signed G Jory Pell to a 1-year deal',
        'Their starter left for Tampa Bay in July',
      ),
      W(
        'o4',
        'Oct 2',
        'DET',
        'cut four players to reach the 23-man limit',
        'Two are waiver claims you could use',
        'Check the waiver list',
        { label: 'Market', target: 'scout' },
      ),
    ],
  },
  regular: {
    phase: 'regular',
    atl: ATLANTIC,
    metro: METRO,
    stand: true,
    games: REG,
    dates: [],
    odds: 71,
    offseason: false,
    needs: [
      N.agent(
        'Brisebois wants 5 years at $7.20M',
        'RW, 24, 21 goals. His deal ends in June. She wants an answer by Monday.',
        'Monday 5:00 PM',
      ),
      N.offer('Expires Sunday'),
      N.goalie('Before 7:00 PM', 'Vuorinen is day to day (lower body)'),
    ],
    wire: [
      W(
        'r1',
        '11:42',
        'OTT',
        'claimed D Ben Hartley off waivers from DET',
        '1.1M under the cap, two D injured',
        'They are your trade partner on Sunday',
        { label: 'View', target: 'league' },
      ),
      W(
        'r2',
        '10:15',
        'FLA',
        'placed C Aiden Brandt on IR, 6 weeks',
        'Collision in practice. Their C depth is now 2 deep',
        undefined,
        { label: 'Standings', target: 'league' },
      ),
      W(
        'r3',
        '9:30',
        'BOS',
        'list three expiring players as available',
        'Out of a playoff spot, 21 days to the deadline',
        'Two are wingers you could use',
        { label: 'Market', target: 'scout' },
      ),
      W(
        'r4',
        'Yesterday',
        'TOR',
        'signed G Mike Reinholt to a 2-year extension',
        'Their starter was 3rd in GSAx',
        undefined,
        { label: 'View', target: 'league' },
      ),
    ],
  },
  deadline: {
    phase: 'deadline',
    atl: at(ATLANTIC, 64),
    metro: at(METRO, 64),
    stand: true,
    games: DEAD,
    dates: [],
    odds: 68,
    offseason: false,
    clock: '04:14:36',
    needs: [
      N.offer('Expires 3:00 PM today'),
      N.agent(
        'Extend Brisebois or trade him',
        'His deal ends in June and she will not talk after 3:00 PM. $7.20M × 5 is the ask.',
        'Today 3:00 PM',
      ),
    ],
    wire: [
      W(
        'd1',
        '10:02',
        'BOS',
        'list three expiring wingers at any price',
        'Out of the race, 9 points back',
        'Two are wingers you could use',
        { label: 'Market', target: 'scout' },
      ),
      W('d2', '9:41', 'DET', 'shop D Marek Voss, 31', 'Rebuilding. Asking for a 2nd', undefined, {
        label: 'Market',
        target: 'scout',
      }),
      W(
        'd3',
        '9:10',
        'FLA',
        'want a centre after losing Brandt',
        'Buyers with $2.1M in space',
        undefined,
        { label: 'League', target: 'league' },
      ),
      W(
        'd4',
        '8:30',
        'OTT',
        'called about Calvin Marsh',
        'Their offer is on your desk',
        'Expires at 3:00 PM',
        { label: 'Roster', target: 'roster' },
      ),
    ],
  },
  playoffs: {
    phase: 'playoffs',
    atl: FINAL.atl,
    metro: FINAL.metro,
    stand: false,
    games: PO,
    dates: [],
    odds: null,
    offseason: false,
    needs: [
      N.goalie('Before 7:30 PM', 'Vuorinen is a game-time call'),
      N.lineup(
        'Hrubý is back. Play him on line 2?',
        'He missed three games. Okafor has played well in his place.',
        'Before 7:30 PM',
      ),
    ],
    wire: [
      W(
        'p1',
        '11:05',
        OPP.ab,
        'C Aiden Brandt practised, game-time decision',
        'Missed the first four games of the series',
        undefined,
        { label: 'League', target: 'league' },
      ),
      W(
        'p2',
        '10:30',
        A[0]!.ab,
        `lead their series ${OTHER_SCORES[0]![0]}–${OTHER_SCORES[0]![1]}`,
        'The top seed has not trailed in a game',
      ),
      W(
        'p3',
        '9:50',
        'CAR',
        'lose D Jack Stead to a suspension',
        'Two games for a hit from behind',
      ),
      W(
        'p4',
        'Yesterday',
        'MTL',
        'the series is tied 2–2',
        'Home ice decides it from here',
        undefined,
        { label: 'View', target: 'league' },
      ),
    ],
  },
  draft: {
    phase: 'draft',
    atl: FINAL.atl,
    metro: FINAL.metro,
    stand: false,
    games: [],
    dates: ['Saturday, June 26'],
    odds: null,
    offseason: true,
    needs: [],
    wire: [
      W(
        'x1',
        '7:05 PM',
        'NYI',
        'called about pick 9',
        'Two offers are in your draft room',
        undefined,
        { label: 'Scout', target: 'scout' },
      ),
      W(
        'x2',
        '6:58 PM',
        'SEA',
        'took the first winger off the board at 5',
        'Two wingers left in your top ten',
        undefined,
        { label: 'Scout', target: 'scout' },
      ),
      W('x3', '6:40 PM', 'CHI', 'picked D Anton Sjöberg at 2', 'The first defenceman gone'),
      W(
        'x4',
        'Yesterday',
        'DET',
        'sent pick 9 to Montréal last summer',
        'Detroit keeps your 2nd-rounder',
      ),
    ],
  },
  fa: {
    phase: 'fa',
    atl: FINAL.atl,
    metro: FINAL.metro,
    stand: false,
    games: [],
    dates: ['Thursday, July 1', 'Friday, July 2', 'Saturday, July 3', 'Sunday, July 4'],
    odds: null,
    offseason: true,
    needs: [
      N.agent(
        'Brisebois is a free agent. Re-sign him',
        'His deal expired at midnight. Three teams have called. $7.20M × 5 is the ask.',
        'Before 5:00 PM',
      ),
    ],
    wire: [
      W(
        'f1',
        '12:04',
        'TOR',
        'signed D Ethan Cole to 4 years, $4.50M',
        'Their top-pair D left for Boston',
        undefined,
        { label: 'Market', target: 'scout' },
      ),
      W(
        'f2',
        '12:01',
        'DET',
        'signed RW Sasha Voronin to 6 years, $7.00M',
        'He was your top target',
        'Gone. Aidan Park is next',
        { label: 'Market', target: 'scout' },
      ),
      W(
        'f3',
        '12:00',
        'BOS',
        'signed G Gus Heller to 1 year, $1.80M',
        'Cheapest starter on the market',
      ),
      W(
        'f4',
        '11:59',
        'MTL',
        'Noah Brisebois reached free agency',
        'Three teams have called his agent',
        'Dana wants a yes by 5:00 PM',
        { label: 'Roster', target: 'roster' },
      ),
    ],
  },
};

/* ---------- roster for a date ---------- */
export function rosterOf(phase: Phase, traded: string[], signed: Record<string, Ask>): Player[] {
  const off = SNAPS[phase].offseason;
  return ROSTER.filter((p) => !traded.includes(p.id))
    .filter((p) => !(off && p.years === 1 && !signed[p.id]))
    .map((p) => {
      const s = signed[p.id];
      const q: Player = s
        ? { ...p, capHit: s.amount, years: s.years, note: 'Extension signed' }
        : { ...p };
      if (off && !s) {
        q.status = 'OK';
        delete q.note;
      }
      return q;
    });
}
export const capSpace = (pl: Player[], extra = 0): number =>
  CAP - extra - pl.reduce((s, p) => s + p.capHit, 0);

/* ---------- facts ---------- */
export interface Facts {
  snap: Snap;
  game: number;
  date: string;
  rec: { w: number; l: number; otl: number; gp: number };
  pts: number;
  rank: number;
  rankText: string;
  table: PRow[]; // what the Atlantic table shows (projection on opener day)
  atl: PRow[];
  metro: PRow[];
  projected: boolean;
  players: Player[];
  roster: number;
  cap: number;
  next: Game | undefined;
  left: Game[];
  needs: LNeed[];
  series: Series[];
  mySeries: Series | undefined;
}
export const ord = (n: number): string =>
  `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`;
const play = (rows: Row[], snap: Snap, game: number): Row[] => {
  const out = rows.map((r) => ({ ...r }));
  if (!snap.stand) return out;
  for (const m of snap.games.slice(0, game)) {
    const won = m.res[0] > m.res[1];
    for (const [ab, w, ot] of [
      ['MTL', won, !won && m.res[2]],
      [m.ab, !won, won && m.res[2]],
    ] as const) {
      const r = out.find((x) => x.ab === ab);
      if (!r) continue;
      r.gp++;
      if (w) r.w++;
      else if (ot) r.otl++;
      else r.l++;
    }
  }
  return out;
};
export function factsOf(
  phase: Phase,
  game: number,
  traded: string[],
  signed: Record<string, Ask>,
  extraCap: number,
  resolved: Record<string, string> = {},
): Facts {
  const snap = SNAPS[phase];
  const atl = rank(play(snap.atl, snap, game));
  const metro = rank(play(snap.metro, snap, game));
  const projected = !!snap.projAtl;
  const table = projected ? rank(snap.projAtl!) : atl;
  const me = atl.find((r) => r.ab === 'MTL')!;
  const players = rosterOf(phase, traded, signed);
  const rk = table.findIndex((r) => r.ab === 'MTL') + 1;
  const series = SERIES_BASE.map((s) => {
    if (!s.me) return s;
    let { sa, sb } = s;
    for (const m of snap.games.slice(0, game)) {
      const won = m.res[0] > m.res[1];
      if (homeIce === won) sa++;
      else sb++;
    }
    return { ...s, sa, sb };
  });
  const left = snap.games.slice(game);
  const f: Facts = {
    snap,
    game,
    date:
      snap.games[Math.min(game, snap.games.length - 1)]?.date ??
      snap.dates[Math.min(game, snap.dates.length - 1)] ??
      '',
    rec: { w: me.w, l: me.l, otl: me.otl, gp: me.gp },
    pts: me.p,
    rank: rk,
    rankText: projected ? `Projected ${ord(rk)}` : ord(rk),
    table,
    atl,
    metro,
    projected,
    players,
    roster: players.length,
    cap: capSpace(players, extraCap),
    next: snap.games[game],
    left,
    needs: snap.needs.filter(
      (n) =>
        !resolved[n.id] &&
        !(n.id === 'offer' && traded.includes('marsh')) &&
        !(n.id === 'agent' && signed['brisebois']),
    ),
    series,
    mySeries: series.find((s) => s.me),
  };
  checkFacts(f);
  return f;
}

/** Dev check, part 1: the numbers have to add up. Throws, so a bad edit cannot ship quietly. */
function checkFacts(f: Facts): void {
  const bad = (m: string): never => {
    throw new Error(`league-state mismatch (${f.snap.phase}): ${m}`);
  };
  const { w, l, otl, gp } = f.rec;
  if (w + l + otl !== gp) bad(`record ${w}-${l}-${otl} is not ${gp} games`);
  if (f.pts !== w * 2 + otl) bad('points do not match the record');
  const row = f.atl.find((r) => r.ab === 'MTL');
  if (!row || row.w !== w || row.p !== f.pts) bad('standings row differs from the record');
  if (f.table[f.rank - 1]?.ab !== 'MTL') bad('rank does not point at Montréal');
  if (f.players.length !== f.roster) bad('roster count');
  if (f.snap.offseason && f.players.some((p) => p.years === 1 && !p.note))
    bad('an expired contract is still on the roster');
}
/** Dev check, part 2: any element tagged data-fact must agree with every other element of the same fact. */
export function checkDom(root: HTMLElement | null): void {
  if (!root) return;
  const seen = new Map<string, string>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-fact]')) {
    const k = el.dataset.fact!;
    const v = el.dataset.v ?? '';
    const prev = seen.get(k);
    if (prev !== undefined && prev !== v)
      throw new Error(`screens disagree on "${k}": ${prev} vs ${v}`);
    seen.set(k, v);
  }
}

/* ---------- small derived helpers ---------- */
/** Position group with the weakest top end, so Market and Scout can say what the team lacks. */
export function weakPos(players: Player[]): { pos: string; avg: number } {
  const need: Record<string, number> = { C: 3, LW: 3, RW: 3, D: 4, G: 1 };
  let worst = { pos: 'D', avg: 999 };
  for (const [pos, n] of Object.entries(need)) {
    const top = players
      .filter((p) => p.pos === pos)
      .map((p) => p.ovr)
      .sort((a, b) => b - a)
      .slice(0, n);
    const avg = top.length ? top.reduce((s, x) => s + x, 0) / top.length : 0;
    if (avg < worst.avg) worst = { pos, avg };
  }
  return { pos: worst.pos, avg: Math.round(worst.avg) };
}
export const OUR_PICK = { slot: 9, via: 'Detroit', own: 20 };
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
export const EVENTS: { id: Phase; when: string; what: string; verb: string; at: number }[] = [
  {
    id: 'opener',
    when: 'Tue Oct 6',
    what: 'Season opener at home vs Toronto',
    verb: 'Play opening night',
    at: day(2026, 10, 6),
  },
  {
    id: 'deadline',
    when: 'Fri Mar 5',
    what: 'Trade deadline, 3:00 PM',
    verb: 'Sim to the deadline',
    at: day(2027, 3, 5),
  },
  {
    id: 'playoffs',
    when: 'Mon Apr 26',
    what: 'Round one, Game 5',
    verb: 'Start the playoffs',
    at: day(2027, 4, 26),
  },
  {
    id: 'draft',
    when: 'Sat Jun 26',
    what: 'Entry draft, round 1',
    verb: 'Go to the draft',
    at: day(2027, 6, 26),
  },
  {
    id: 'fa',
    when: 'Thu Jul 1',
    what: 'Free agency opens, noon',
    verb: 'Open free agency',
    at: day(2027, 7, 1),
  },
];
const NOW: Record<Phase, number> = {
  opener: day(2026, 10, 6),
  regular: day(2027, 2, 12),
  deadline: day(2027, 3, 5),
  playoffs: day(2027, 4, 26),
  draft: day(2027, 6, 26),
  fa: day(2027, 7, 1),
};
export const nowOf = (p: Phase): number => NOW[p];
export const daysTo = (p: Phase, at: number): number => Math.round((at - NOW[p]) / 86_400_000);
