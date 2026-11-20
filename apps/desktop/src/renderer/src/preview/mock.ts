// Mock data for the UI preview only. Invented players on real city names; nothing here is read
// from, or written to, the game. Money is integer dollars, like the rest of the app.

export type Pos = 'C' | 'LW' | 'RW' | 'D' | 'G';
export type Status = 'OK' | 'DTD' | 'IR';

export interface Player {
  id: string;
  name: string;
  num: number;
  pos: Pos;
  line: string; // deployment slot: F1..F4, D1..D3, G1, G2, X (scratch)
  age: number;
  ovr: number;
  capHit: number;
  years: number;
  status: Status;
  note?: string;
  gp: number;
  g: number;
  a: number;
  xgf: number; // expected goals for % at 5v5 (goalies: GSAx in `gsax`)
  toi: string;
  svp?: number;
  gsax?: number;
  nmc?: boolean;
  ht: string;
  shoots: 'L' | 'R';
  traits: string[];
}

export const CAP = 104_000_000;

const p = (
  id: string,
  name: string,
  num: number,
  pos: Pos,
  line: string,
  age: number,
  ovr: number,
  capM: number,
  years: number,
  stats: [number, number, number, number, string],
  ht: string,
  shoots: 'L' | 'R',
  traits: string[],
  extra: Partial<Pick<Player, 'status' | 'note' | 'svp' | 'gsax' | 'nmc'>> = {},
): Player => ({
  id,
  name,
  num,
  pos,
  line,
  age,
  ovr,
  capHit: Math.round(capM * 1_000_000),
  years,
  status: 'OK',
  gp: stats[0],
  g: stats[1],
  a: stats[2],
  xgf: stats[3],
  toi: stats[4],
  ht,
  shoots,
  traits: traits.length ? traits : [],
  ...extra,
});

export const ROSTER: Player[] = [
  p(
    'rochefort',
    'Mathis Rochefort',
    13,
    'LW',
    'F1',
    25,
    84,
    9.5,
    5,
    [55, 27, 29, 55.4, '19:48'],
    "6'1",
    'L',
    ['Sniper', 'Net-front'],
  ),
  p(
    'lindqvist',
    'Jakob Lindqvist',
    71,
    'C',
    'F1',
    27,
    87,
    11,
    4,
    [56, 24, 43, 57.9, '20:52'],
    "6'3",
    'L',
    ['Playmaker', 'Disciplined'],
    { nmc: true },
  ),
  p(
    'brisebois',
    'Noah Brisebois',
    22,
    'RW',
    'F1',
    24,
    79,
    0.95,
    1,
    [54, 21, 22, 54.1, '18:31'],
    "5'11",
    'R',
    ['Finisher'],
    { note: 'Contract ends in June' },
  ),
  p(
    'marsh',
    'Calvin Marsh',
    17,
    'LW',
    'F2',
    29,
    77,
    6,
    3,
    [53, 15, 18, 51.2, '16:40'],
    "6'2",
    'L',
    ['Two-way'],
  ),
  p(
    'lavallee',
    'Étienne Lavallée',
    8,
    'C',
    'F2',
    31,
    80,
    7.75,
    2,
    [56, 14, 31, 52.6, '17:58'],
    "6'0",
    'R',
    ['Faceoff specialist'],
  ),
  p('hruby', 'Tomáš Hrubý', 29, 'RW', 'F2', 26, 78, 7, 4, [55, 18, 20, 50.8, '16:22'], "6'0", 'R', [
    'Perimeter',
  ]),
  p(
    'pelletier',
    'Owen Pelletier',
    47,
    'LW',
    'F3',
    23,
    72,
    1.2,
    2,
    [52, 9, 8, 49.3, '13:44'],
    "5'10",
    'L',
    ['Speed'],
  ),
  p('gagnon', 'Luc Gagnon', 36, 'C', 'F3', 28, 73, 3.1, 2, [56, 8, 13, 49.9, '14:05'], "6'1", 'L', [
    'Two-way',
  ]),
  p(
    'teague',
    'Brandon Teague',
    14,
    'RW',
    'F3',
    30,
    71,
    2.5,
    1,
    [50, 7, 9, 48.0, '13:12'],
    "6'2",
    'R',
    ['Physical'],
  ),
  p('okafor', 'Sam Okafor', 52, 'LW', 'F4', 26, 66, 1, 1, [48, 3, 4, 47.5, '10:21'], "6'3", 'L', [
    'Physical',
  ]),
  p(
    'desrosiers',
    'Victor Desrosiers',
    20,
    'C',
    'F4',
    33,
    68,
    1.75,
    1,
    [55, 4, 6, 46.9, '10:48'],
    "5'11",
    'L',
    ['Penalty killer'],
  ),
  p('voss', 'Ryan Voss', 61, 'RW', 'F4', 27, 65, 0.9, 2, [47, 2, 5, 46.1, '9:57'], "6'0", 'R', [
    'Energy',
  ]),
  p(
    'tallstrom',
    'Henrik Tallström',
    6,
    'D',
    'D1',
    28,
    85,
    9.75,
    6,
    [56, 11, 38, 56.7, '25:17'],
    "6'4",
    'L',
    ['Puck mover'],
    { nmc: true },
  ),
  p(
    'roy',
    'Marc-Antoine Roy',
    44,
    'D',
    'D1',
    25,
    78,
    4.75,
    3,
    [56, 6, 22, 53.0, '23:09'],
    "6'1",
    'R',
    ['Two-way'],
  ),
  p(
    'whitlock',
    'Cam Whitlock',
    5,
    'D',
    'D2',
    30,
    76,
    6,
    2,
    [54, 4, 15, 51.5, '20:03'],
    "6'2",
    'L',
    ['Defensive'],
  ),
  p(
    'kravchenko',
    'Ilya Kravchenko',
    26,
    'D',
    'D2',
    24,
    74,
    2.35,
    2,
    [55, 5, 14, 50.4, '19:30'],
    "6'0",
    'R',
    ['Offensive'],
  ),
  p('hartley', 'Ben Hartley', 3, 'D', 'D3', 32, 69, 3, 1, [51, 1, 8, 48.8, '16:11'], "6'3", 'L', [
    'Physical',
  ]),
  p('pike', 'Jordan Pike', 58, 'D', 'D3', 22, 67, 0.95, 2, [43, 2, 6, 48.1, '15:40'], "6'1", 'R', [
    'Prospect',
  ]),
  p(
    'vuorinen',
    'Anders Vuorinen',
    31,
    'G',
    'G1',
    29,
    83,
    8.4,
    3,
    [44, 0, 1, 0, '60:00'],
    "6'4",
    'L',
    ['Athletic'],
    { status: 'DTD', note: 'Lower body, day to day', svp: 0.918, gsax: 9.2 },
  ),
  p(
    'fontaine',
    'Philippe Fontaine',
    35,
    'G',
    'G2',
    33,
    70,
    2,
    1,
    [14, 0, 0, 0, '60:00'],
    "6'1",
    'L',
    ['Positional'],
    { svp: 0.903, gsax: -1.1 },
  ),
  p('bruce', 'Tyler Bruce', 77, 'LW', 'X', 22, 62, 0.85, 1, [9, 1, 1, 45.0, '9:02'], "6'0", 'L', [
    'Prospect',
  ]),
  p('nygard', 'Elias Nygård', 81, 'D', 'X', 21, 60, 0.8, 1, [6, 0, 1, 46.2, '14:19'], "6'2", 'R', [
    'Prospect',
  ]),
];

export const byId = (id: string): Player | undefined => ROSTER.find((r) => r.id === id);

export interface Ask {
  amount: number;
  years: number;
}
export function askFor(pl: Player): Ask {
  if (pl.id === 'brisebois') return { amount: 7_200_000, years: 5 };
  const base = Math.max(0.775, (pl.ovr - 62) * 0.38);
  return {
    amount: Math.round((base * 1_000_000) / 50_000) * 50_000,
    years: pl.age < 26 ? 5 : pl.age < 31 ? 3 : 1,
  };
}

export const fmtM = (n: number): string => `$${(n / 1_000_000).toFixed(2)}M`;
export const fmtM1 = (n: number): string => `$${(n / 1_000_000).toFixed(1)}M`;

/* ---------- teams and standings ---------- */

export type TeamKey = 'MTL' | 'TOR' | 'BOS' | 'SJS';
export interface TeamTheme {
  city: string;
  nick: string;
  /** fill: buttons, jersey tint. text: key numbers on graphite (a lighter step of the same hue). */
  fill: string;
  text: string;
  second: string;
}
export const TEAMS: Record<TeamKey, TeamTheme> = {
  MTL: { city: 'Montréal', nick: 'Montréal', fill: '#af1e2d', text: '#e5475a', second: '#1d2c70' },
  TOR: { city: 'Toronto', nick: 'Toronto', fill: '#1f4fb4', text: '#6f9cf0', second: '#e8e8e8' },
  BOS: { city: 'Boston', nick: 'Boston', fill: '#c99a0e', text: '#f3c13a', second: '#14110e' },
  SJS: { city: 'San Jose', nick: 'San Jose', fill: '#0b7d86', text: '#38c1ca', second: '#14110e' },
};

export interface Row {
  ab: string;
  name: string;
  gp: number;
  w: number;
  l: number;
  otl: number;
}
export const pts = (r: Row): number => r.w * 2 + r.otl;

export const ATLANTIC: Row[] = [
  { ab: 'TOR', name: 'Toronto', gp: 56, w: 34, l: 17, otl: 5 },
  { ab: 'FLA', name: 'Florida', gp: 56, w: 33, l: 19, otl: 4 },
  { ab: 'TBL', name: 'Tampa Bay', gp: 56, w: 32, l: 20, otl: 4 },
  { ab: 'MTL', name: 'Montréal', gp: 56, w: 31, l: 19, otl: 6 },
  { ab: 'BOS', name: 'Boston', gp: 56, w: 29, l: 22, otl: 5 },
  { ab: 'OTT', name: 'Ottawa', gp: 55, w: 28, l: 23, otl: 4 },
  { ab: 'DET', name: 'Detroit', gp: 56, w: 26, l: 24, otl: 6 },
  { ab: 'BUF', name: 'Buffalo', gp: 56, w: 22, l: 28, otl: 6 },
];

/** Results the Continue button plays through, in order: [Montréal goals, opponent goals, overtime?]. */
export const SCHEDULE: {
  opp: string;
  ab: string;
  home: boolean;
  when: string;
  res: [number, number, boolean];
}[] = [
  { opp: 'Toronto', ab: 'TOR', home: true, when: 'Tonight · 7:00 PM', res: [4, 2, false] },
  { opp: 'Ottawa', ab: 'OTT', home: false, when: 'Saturday · 7:00 PM', res: [2, 3, true] },
  { opp: 'Florida', ab: 'FLA', home: true, when: 'Monday · 7:30 PM', res: [3, 1, false] },
  { opp: 'Buffalo', ab: 'BUF', home: false, when: 'Wednesday · 7:00 PM', res: [1, 4, false] },
  { opp: 'Boston', ab: 'BOS', home: true, when: 'Friday · 7:00 PM', res: [5, 3, false] },
];

/* ---------- Home ---------- */

export interface Need {
  id: 'agent' | 'offer' | 'goalie';
  who: string;
  title: string;
  detail: string;
  due: string;
}
export const NEEDS: Need[] = [
  {
    id: 'agent',
    who: 'Dana Kessler · agent',
    title: 'Brisebois wants 5 years at $7.20M',
    detail: 'RW, 24, 21 goals. His deal ends in June. She wants an answer before Friday.',
    due: 'Friday 5:00 PM',
  },
  {
    id: 'offer',
    who: 'Ottawa',
    title: '2027 1st and a D prospect for Calvin Marsh',
    detail: 'Marsh is 29, $6.00M through 2029. Taking it frees $6.00M of cap space.',
    due: 'Expires Saturday',
  },
  {
    id: 'goalie',
    who: 'Medical',
    title: 'Vuorinen is day to day (lower body)',
    detail: 'He practised in a no-contact jersey. Fontaine is 0.903 SV%, 14 starts.',
    due: 'Before 7:00 PM',
  },
];

export interface Wire {
  id: string;
  at: string;
  team: string;
  text: string;
  cause: string;
  you?: string;
  go?: { label: string; target: 'roster' | 'scout' | 'league' };
}
export const WIRE: Wire[] = [
  {
    id: 'w1',
    at: '11:42',
    team: 'OTT',
    text: 'claimed D Ben Hartley-type depth off waivers from DET',
    cause: '1.1M under the cap, two D injured',
    you: 'They are your trade partner tonight',
    go: { label: 'View', target: 'league' },
  },
  {
    id: 'w2',
    at: '10:15',
    team: 'FLA',
    text: 'placed C Aiden Brandt on IR, 6 weeks',
    cause: 'Collision in practice. Their C depth is now 2 deep',
    go: { label: 'Standings', target: 'league' },
  },
  {
    id: 'w3',
    at: '9:30',
    team: 'BOS',
    text: 'list three expiring players as available',
    cause: '6 points out of a playoff spot, 31 days to the deadline',
    you: 'Two are wingers you could use',
    go: { label: 'Scout', target: 'scout' },
  },
  {
    id: 'w4',
    at: 'Yesterday',
    team: 'TOR',
    text: 'signed G Mike Reinholt to a 2-year extension',
    cause: 'Their starter was 3rd in GSAx',
    go: { label: 'View', target: 'league' },
  },
  {
    id: 'w5',
    at: 'Yesterday',
    team: 'DET',
    text: 'fired head coach Alan Morrow',
    cause: 'Lost 8 of 10, owner confidence at 31',
  },
];

/* ---------- Draft ---------- */

export interface Prospect {
  id: string;
  name: string;
  pos: string;
  from: string;
  age: number;
  rank: number;
  ovr: string;
  note: string;
  num: number;
}
export const PROSPECTS: Prospect[] = [
  {
    id: 'pr1',
    name: 'Léo Marchand',
    pos: 'C',
    from: 'Rouyn-Noranda (QMJHL)',
    age: 18,
    rank: 1,
    ovr: '78-90',
    note: 'Elite edge work, shoots before the defender is set.',
    num: 9,
  },
  {
    id: 'pr2',
    name: 'Anton Sjöberg',
    pos: 'D',
    from: 'Frölunda J20',
    age: 18,
    rank: 2,
    ovr: '75-88',
    note: 'Calm under pressure. Needs two years to fill out.',
    num: 4,
  },
  {
    id: 'pr3',
    name: 'Caleb Whitfield',
    pos: 'LW',
    from: 'Kitchener (OHL)',
    age: 18,
    rank: 3,
    ovr: '74-86',
    note: 'Power forward. Skates better than he looks.',
    num: 17,
  },
  {
    id: 'pr4',
    name: 'Matvei Orlov',
    pos: 'C',
    from: 'Krasnaya Armiya',
    age: 18,
    rank: 4,
    ovr: '72-87',
    note: 'Highest ceiling in the class, longest road.',
    num: 71,
  },
  {
    id: 'pr5',
    name: 'Dawson Pruitt',
    pos: 'G',
    from: 'Saskatoon (WHL)',
    age: 18,
    rank: 5,
    ovr: '70-85',
    note: 'Rare goalie in the top ten. Reads the play early.',
    num: 30,
  },
  {
    id: 'pr6',
    name: 'Simon Tessier',
    pos: 'RW',
    from: 'Drummondville (QMJHL)',
    age: 18,
    rank: 6,
    ovr: '70-82',
    note: 'Local kid, 41 goals. Ready to play next fall.',
    num: 22,
  },
  {
    id: 'pr7',
    name: 'Eero Salminen',
    pos: 'D',
    from: 'TPS U20',
    age: 18,
    rank: 7,
    ovr: '68-82',
    note: 'Shutdown defenceman with a real shot.',
    num: 28,
  },
  {
    id: 'pr8',
    name: 'Gabe Okonkwo',
    pos: 'C',
    from: 'USNTDP',
    age: 18,
    rank: 8,
    ovr: '67-81',
    note: 'Faceoff ace. Safe pick, lower upside.',
    num: 12,
  },
];

/** Picks already made when the preview opens: picks 1 to 8. Montréal holds pick 9. */
export const MADE: { pick: number; ab: string; name: string; pos: string }[] = [
  { pick: 1, ab: 'SJS', name: 'Léo Marchand', pos: 'C' },
  { pick: 2, ab: 'CHI', name: 'Anton Sjöberg', pos: 'D' },
  { pick: 3, ab: 'NSH', name: 'Caleb Whitfield', pos: 'LW' },
  { pick: 4, ab: 'UTA', name: 'Matvei Orlov', pos: 'C' },
  { pick: 5, ab: 'SEA', name: 'Rhys Calloway', pos: 'LW' },
  { pick: 6, ab: 'CGY', name: 'Jonas Eklund', pos: 'D' },
  { pick: 7, ab: 'PHI', name: 'Dmitri Volkov', pos: 'RW' },
  { pick: 8, ab: 'CBJ', name: 'Théo Bergeron', pos: 'C' },
];
export const BOARD_AFTER: { pick: number; ab: string }[] = [
  { pick: 10, ab: 'NYI' },
  { pick: 11, ab: 'STL' },
  { pick: 12, ab: 'DET' },
];

/* ---------- game-day result cards (parallel to SCHEDULE) ---------- */
export const RESULT_TEXT: { stars: string[]; why: string }[] = [
  {
    stars: ['Lindqvist, 2 A', 'Rochefort, 2 G', 'Vuorinen, 31 saves'],
    why: 'Montréal scored twice in the second period on the power play and never trailed.',
  },
  {
    stars: ['Roy, 1 G', 'Ottawa G, 38 saves', 'Lavallée, 1 G'],
    why: 'Lost in overtime after Ottawa’s goalie stole a point. Montréal outshot them 41–26.',
  },
  {
    stars: ['Tallström, 1 G 1 A', 'Marsh, 1 G', 'Fontaine, 24 saves'],
    why: 'Florida had two penalties in the third. Montréal scored on both.',
  },
  {
    stars: ['Buffalo G, 35 saves', 'Buffalo C, 2 G', 'Roy, 1 A'],
    why: 'Two early goals against and no way back. Vuorinen rested, Fontaine pulled in the second.',
  },
  {
    stars: ['Brisebois, 2 G', 'Lindqvist, 3 A', 'Hrubý, 1 G 1 A'],
    why: 'Line one scored four of the five. Boston’s power play went 0 for 5.',
  },
];

/* ---------- other teams, market, calendar ---------- */
export const METRO: Row[] = [
  { ab: 'CAR', name: 'Carolina', gp: 56, w: 35, l: 16, otl: 5 },
  { ab: 'NJD', name: 'New Jersey', gp: 56, w: 32, l: 19, otl: 5 },
  { ab: 'WSH', name: 'Washington', gp: 56, w: 30, l: 21, otl: 5 },
  { ab: 'NYR', name: 'NY Rangers', gp: 56, w: 29, l: 22, otl: 5 },
  { ab: 'PIT', name: 'Pittsburgh', gp: 56, w: 26, l: 24, otl: 6 },
  { ab: 'CBJ', name: 'Columbus', gp: 56, w: 24, l: 26, otl: 6 },
  { ab: 'NYI', name: 'NY Islanders', gp: 56, w: 23, l: 27, otl: 6 },
  { ab: 'PHI', name: 'Philadelphia', gp: 56, w: 21, l: 29, otl: 6 },
];
export const FA_BOARD: {
  name: string;
  pos: string;
  age: number;
  ovr: number;
  ask: string;
  interest: string;
}[] = [
  {
    name: 'Sasha Voronin',
    pos: 'RW',
    age: 27,
    ovr: 83,
    ask: '$7.00M × 6',
    interest: 'Leaning Detroit',
  },
  { name: 'Marek Dolan', pos: 'D', age: 26, ovr: 78, ask: '$5.50M × 4', interest: '2 other teams' },
  {
    name: 'Aidan Park',
    pos: 'C',
    age: 29,
    ovr: 75,
    ask: '$3.25M × 2',
    interest: 'Agent says tonight',
  },
  { name: 'Liam Strand', pos: 'LW', age: 31, ovr: 74, ask: '$3.00M × 2', interest: 'Open' },
  { name: 'Gus Heller', pos: 'G', age: 34, ovr: 72, ask: '$1.80M × 1', interest: 'Open' },
  { name: 'Tomas Reiter', pos: 'D', age: 24, ovr: 71, ask: '$2.40M × 3', interest: '1 other team' },
  { name: 'Kyle Brandt', pos: 'C', age: 30, ovr: 70, ask: '$2.00M × 1', interest: 'Open' },
  { name: 'Ivan Petrov', pos: 'RW', age: 23, ovr: 69, ask: '$1.10M × 2', interest: 'Restricted' },
];
export const DEADLINE_BOARD: {
  ab: string;
  name: string;
  role: 'Buyer' | 'Seller' | 'Bubble';
  gap: string;
  has: string;
}[] = [
  { ab: 'BOS', name: 'Boston', role: 'Seller', gap: '6 pts out', has: '3 expiring wingers' },
  { ab: 'DET', name: 'Detroit', role: 'Seller', gap: '9 pts out', has: 'D Marek Voss, 31' },
  { ab: 'OTT', name: 'Ottawa', role: 'Bubble', gap: '2 pts out', has: 'D depth, wants a 1st' },
  { ab: 'FLA', name: 'Florida', role: 'Buyer', gap: 'In', has: 'Needs a C (hurt)' },
  { ab: 'TBL', name: 'Tampa Bay', role: 'Buyer', gap: 'In', has: 'Cap tight, wants a rental' },
];
export const CALENDAR: {
  when: string;
  what: string;
  phase: 'opener' | 'deadline' | 'fa' | 'playoffs' | 'draft';
}[] = [
  { when: 'Tue Oct 6', what: 'Season opener at home vs Toronto', phase: 'opener' },
  { when: 'Thu Mar 5', what: 'Trade deadline, 3:00 PM', phase: 'deadline' },
  { when: 'Tue Apr 21', what: 'Playoffs begin', phase: 'playoffs' },
  { when: 'Fri Jun 26', what: 'Entry draft, round 1', phase: 'draft' },
  { when: 'Wed Jul 1', what: 'Free agency opens, noon', phase: 'fa' },
];
export const DRAFT_RUN: string[] = [
  'Seattle takes Rhys Calloway. The first winger off the board.',
  'Calgary goes defence with Jonas Eklund. A run on defencemen has started.',
  'Philadelphia takes Dmitri Volkov. Montréal is two picks from the clock.',
  'Columbus picks Théo Bergeron. Your phone is ringing: two teams want pick 9.',
];

/* ---------- trade table assets ---------- */
export interface Asset {
  id: string;
  label: string;
  sub: string;
  value: number;
  cap: number; // dollars of cap that moves with this asset
  player?: string; // roster id when it is one of your players
}
export const OTT_ASSETS: Asset[] = [
  { id: 'o1', label: '2027 1st-round pick', sub: 'Ottawa · about No. 14', value: 40, cap: 0 },
  { id: 'o2', label: '2027 2nd-round pick', sub: 'Ottawa · about No. 45', value: 16, cap: 0 },
  { id: 'o3', label: '2028 2nd-round pick', sub: 'Ottawa', value: 12, cap: 0 },
  { id: 'o4', label: 'Kasper Lund, D prospect', sub: '19 · 68–80', value: 14, cap: 900_000 },
  { id: 'o5', label: 'Hugo Ferland, C prospect', sub: '20 · 66–78', value: 12, cap: 900_000 },
  { id: 'o6', label: 'Reid Camden, W', sub: '26 · 76 OVR', value: 40, cap: 4_100_000 },
  { id: 'o7', label: 'Pavel Greer, D', sub: '29 · 72 OVR', value: 28, cap: 2_600_000 },
];
export const MY_EXTRAS: Asset[] = [
  { id: 'm1', label: '2027 1st-round pick', sub: 'Montréal · about No. 20', value: 36, cap: 0 },
  { id: 'm2', label: '2028 2nd-round pick', sub: 'Montréal', value: 12, cap: 0 },
  {
    id: 'm3',
    label: 'Tyler Bruce, LW prospect',
    sub: '22 · 62 OVR',
    value: 10,
    cap: 850_000,
    player: 'bruce',
  },
  {
    id: 'm4',
    label: 'Elias Nygård, D prospect',
    sub: '21 · 60 OVR',
    value: 10,
    cap: 800_000,
    player: 'nygard',
  },
];
export const OTT_CAP_SPACE = 6_500_000;
/** Trade value of one of your players: skill first, then an age adjustment. */
export const worth = (p: Player): number =>
  Math.round(Math.max(5, (p.ovr - 60) * 3.2) * (p.age > 30 ? 0.7 : p.age < 24 ? 1.2 : 1));
