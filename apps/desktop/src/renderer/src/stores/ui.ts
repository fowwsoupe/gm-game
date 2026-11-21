import { create } from 'zustand';
import type { Locale } from '@/i18n';

/**
 * UI-only state (which screen is open, language, selections, filters).
 * Game state lives in the save file in the main process, never here.
 */
export type Screen =
  | 'home'
  | 'news'
  | 'standings'
  | 'roster'
  | 'freeAgency'
  | 'lines'
  | 'trades'
  | 'draft'
  | 'cap'
  | 'games'
  | 'leaders'
  | 'history'
  | 'team'
  | 'owner'
  | 'frontOffice'
  | 'player'
  | 'online';

interface UiState {
  screen: Screen;
  /** Team shown on the team page. */
  teamId: string | undefined;
  openTeam: (teamId: string) => void;
  locale: Locale;
  /** Set by Cmd+K: the Roster screen shows this team and player ('fa' opens Free agency). */
  focus: { teamId: string; playerId?: string | undefined } | null;
  setScreen: (screen: Screen) => void;
  setLocale: (locale: Locale) => void;
  openRoster: (teamId: string, playerId?: string) => void;
  /** The player's own page. `teamId` null = a free agent. */
  openPlayer: (teamId: string | null, playerId: string) => void;
  /** Set by the draft room: the Trades screen opens with this team and its pick asked for. */
  tradeAsk: { teamId: string; pickId: string } | null;
  openTrade: (teamId: string, pickId: string) => void;
  /** Set by Home's Watch: the Games screen opens on this team's game of that league day. */
  watch: { teamId: string; day: number } | null;
  openWatch: (teamId: string, day: number) => void;
  /** Hot-seat: the human team whose GM has the seat (absent or no longer human = the first one). */
  seat: string | undefined;
  setSeat: (teamId: string | undefined) => void;
  /** Hot-seat hand-over: the seat goes to `teamId`'s GM behind a curtain he lifts himself. */
  curtain: boolean;
  handOver: (teamId: string) => void;
  liftCurtain: () => void;
}

export const useUi = create<UiState>((set) => ({
  screen: 'home',
  teamId: undefined,
  openTeam: (teamId) => set({ screen: 'team', teamId }),
  locale: 'en',
  focus: null,
  openRoster: (teamId, playerId) =>
    set({ screen: teamId === 'fa' ? 'freeAgency' : 'roster', focus: { teamId, playerId } }),
  openPlayer: (teamId, playerId) =>
    set({ screen: 'player', focus: { teamId: teamId ?? 'fa', playerId } }),
  tradeAsk: null,
  openTrade: (teamId, pickId) => set({ screen: 'trades', tradeAsk: { teamId, pickId } }),
  watch: null,
  openWatch: (teamId, day) => set({ screen: 'games', watch: { teamId, day } }),
  setScreen: (screen) => set({ screen, tradeAsk: null, watch: null }),
  setLocale: (locale) => set({ locale }),
  seat: undefined,
  setSeat: (seat) => set({ seat }),
  curtain: false,
  handOver: (seat) => set({ seat, curtain: true, screen: 'home', tradeAsk: null, watch: null }),
  liftCurtain: () => set({ curtain: false }),
}));
