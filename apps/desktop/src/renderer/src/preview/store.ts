import { useMemo } from 'react';
import { create } from 'zustand';
import { ROSTER, askFor, type Ask, type Player, type TeamKey } from './mock';
import { SNAPS, capSpace, factsOf, type Facts, type Phase } from './league';

export type { Phase };
export { capSpace };
export type Section = 'home' | 'roster' | 'market' | 'scout' | 'league' | 'calendar' | 'draft';
export type DrawerMode = 'profile' | 'trade' | 'extend';

export const PHASES: { id: Phase; label: string }[] = [
  { id: 'opener', label: 'Season opener' },
  { id: 'regular', label: 'Regular day' },
  { id: 'deadline', label: 'Trade deadline' },
  { id: 'playoffs', label: 'Playoffs' },
  { id: 'draft', label: 'Draft' },
  { id: 'fa', label: 'Free agency' },
];

export const SECTIONS: { id: Section; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'roster', label: 'Roster' },
  { id: 'market', label: 'Market' },
  { id: 'scout', label: 'Scout' },
  { id: 'league', label: 'League' },
  { id: 'calendar', label: 'Calendar' },
];

export interface Result {
  opp: string;
  ab: string;
  home: boolean;
  mine: number;
  theirs: number;
  ot: boolean;
  stars: string[];
  why: string;
  next: string;
}
interface Menu {
  id: string;
  x: number;
  y: number;
}
interface Peek {
  id: string;
  x: number;
  y: number;
}

interface PV {
  phase: Phase;
  section: Section;
  team: TeamKey;
  drawer: string | null;
  mode: DrawerMode;
  palette: boolean;
  menu: Menu | null;
  peek: Peek | null;
  intro: Phase | null;
  calm: boolean;
  sound: boolean;
  lineOf: Record<string, string>;
  swapLines: (a: string, b: string) => void;
  moveLine: (id: string, line: string) => void;
  view: 'lines' | 'table';
  ovr: boolean; // dev toggle: show OVR numbers instead of role fit
  scouted: Record<string, number>; // 0..3 scouting level for players off our roster
  toggleOvr: () => void;
  scoutMore: (id: string) => void;
  day: string | null; // calendar day open in the detail panel
  gamePreview: boolean;
  setView: (v: 'lines' | 'table') => void;
  setDay: (d: string | null) => void;
  setGamePreview: (v: boolean) => void;
  replayIntro: () => void;
  game: number; // games played through Continue in this preview
  resolved: Record<string, string>; // need id -> what the GM did
  signed: Record<string, Ask>;
  traded: string[];
  extraCap: number; // cap taken on in trades (incoming players)
  result: Result | null;
  toast: string | null;
  setPhase: (p: Phase) => void;
  go: (s: Section) => void;
  setTeam: (t: TeamKey) => void;
  open: (id: string, mode?: DrawerMode) => void;
  close: () => void;
  setPalette: (v: boolean) => void;
  setMenu: (m: Menu | null) => void;
  setPeek: (p: Peek | null) => void;
  endIntro: () => void;
  toggleCalm: () => void;
  toggleSound: () => void;
  resolve: (id: string, how: string) => void;
  sign: (id: string, ask: Ask) => void;
  trade: (id: string, extra?: string[], inCap?: number) => void;
  clearResult: () => void;
  continueGame: () => void;
  say: (t: string | null) => void;
}

const reduced =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const usePv = create<PV>((set, get) => ({
  phase: 'regular',
  lineOf: {},
  swapLines: (a, b) =>
    set((s) => {
      const la = s.lineOf[a] ?? ROSTER.find((p) => p.id === a)?.line ?? 'X';
      const lb = s.lineOf[b] ?? ROSTER.find((p) => p.id === b)?.line ?? 'X';
      return { lineOf: { ...s.lineOf, [a]: lb, [b]: la } };
    }),
  moveLine: (id, line) => set((s) => ({ lineOf: { ...s.lineOf, [id]: line } })),
  view: 'lines',
  ovr: false,
  scouted: {},
  toggleOvr: () => set((s) => ({ ovr: !s.ovr })),
  scoutMore: (id) =>
    set((s) => ({
      scouted: { ...s.scouted, [id]: Math.min(3, (s.scouted[id] ?? 0) + 1) },
      toast: 'Scout sent. The ranges narrow.',
    })),
  day: null,
  gamePreview: false,
  setView: (view) => set({ view }),
  setDay: (day) => set({ day }),
  setGamePreview: (gamePreview) => set({ gamePreview }),
  replayIntro: () =>
    set((s) => ({ intro: s.phase === 'regular' || s.phase === 'draft' ? null : s.phase })),
  section: 'home',
  team: 'MTL',
  drawer: null,
  mode: 'profile',
  palette: false,
  menu: null,
  peek: null,
  intro: null,
  calm: reduced,
  sound: false,
  game: 0,
  resolved: {},
  signed: {},
  traded: [],
  extraCap: 0,
  result: null,
  toast: null,
  setPhase: (phase) =>
    set((s) => ({
      phase,
      game: 0,
      resolved: {},
      signed: {},
      traded: [],
      lineOf: {},
      extraCap: 0,
      result: null,
      day: null,
      gamePreview: false,
      drawer: null,
      section: phase === 'draft' ? 'draft' : s.section === 'draft' ? 'home' : s.section,
      intro: phase === 'regular' || phase === 'draft' || s.calm ? null : phase,
    })),
  go: (section) => set({ section, drawer: null, menu: null, peek: null }),
  setTeam: (team) => set({ team }),
  open: (drawer, mode = 'profile') => set({ drawer, mode, menu: null, peek: null }),
  close: () => set({ drawer: null, menu: null, peek: null, palette: false, result: null }),
  setPalette: (palette) => set({ palette, peek: null, menu: null }),
  setMenu: (menu) => set({ menu, peek: null }),
  setPeek: (peek) => set({ peek }),
  endIntro: () => set({ intro: null }),
  toggleCalm: () => set((s) => ({ calm: !s.calm })),
  toggleSound: () => set((s) => ({ sound: !s.sound })),
  resolve: (id, how) => set((s) => ({ resolved: { ...s.resolved, [id]: how }, toast: how })),
  sign: (id, ask) =>
    set((s) => ({
      signed: { ...s.signed, [id]: ask },
      resolved: { ...s.resolved, agent: 'Signed' },
      drawer: null,
      toast: `Signed ${ROSTER.find((p) => p.id === id)?.name ?? ''} · ${ask.years} yrs`,
    })),
  trade: (id, extra = [], inCap = 0) =>
    set((s) => ({
      traded: [...s.traded, id, ...extra],
      extraCap: s.extraCap + inCap,
      resolved: id === 'marsh' ? { ...s.resolved, offer: 'Accepted' } : s.resolved,
      drawer: null,
      toast: 'Trade accepted by Ottawa',
    })),
  continueGame: () => {
    const { phase, game: g } = get();
    const snap = SNAPS[phase];
    const m = snap.games[g];
    if (!m) {
      if (snap.dates.length > 1 && g < snap.dates.length - 1)
        return set({ game: g + 1, toast: snap.dates[g + 1] ?? null });
      return set({
        toast: snap.games.length ? 'End of the preview schedule' : 'Nothing to sim on this date',
      });
    }
    const n = snap.games[g + 1];
    set({
      game: g + 1,
      resolved: { ...get().resolved, goalie: get().resolved.goalie ?? 'Fontaine starts' },
      result: {
        opp: m.opp,
        ab: m.ab,
        home: m.home,
        mine: m.res[0],
        theirs: m.res[1],
        ot: m.res[2],
        stars: m.stars,
        why: m.why,
        next: n ? `Next: ${n.home ? 'vs' : 'at'} ${n.opp}` : 'Next: end of the preview schedule',
      },
    });
  },
  clearResult: () => set({ result: null }),
  say: (toast) => set({ toast }),
}));

/** The league as every screen sees it. Nothing else derives numbers. */
export function useFacts(): Facts {
  const phase = usePv((s) => s.phase);
  const game = usePv((s) => s.game);
  const traded = usePv((s) => s.traded);
  const signed = usePv((s) => s.signed);
  const extraCap = usePv((s) => s.extraCap);
  const resolved = usePv((s) => s.resolved);
  return useMemo(
    () => factsOf(phase, game, traded, signed, extraCap, resolved),
    [phase, game, traded, signed, extraCap, resolved],
  );
}
export type { Player };
export { askFor };
