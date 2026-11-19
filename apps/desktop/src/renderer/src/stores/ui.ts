import { create } from 'zustand';
import type { Locale } from '@/i18n';

/**
 * UI-only state (which screen is open, language, selections, filters).
 * Game state lives in the save file in the main process, never here.
 */
export type Screen =
  | 'home'
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
  | 'player';

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
  setScreen: (screen) => set({ screen, tradeAsk: null }),
  setLocale: (locale) => set({ locale }),
}));
