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
  | 'lines'
  | 'trades'
  | 'draft'
  | 'cap'
  | 'games'
  | 'leaders'
  | 'history';

interface UiState {
  screen: Screen;
  locale: Locale;
  setScreen: (screen: Screen) => void;
  setLocale: (locale: Locale) => void;
}

export const useUi = create<UiState>((set) => ({
  screen: 'home',
  locale: 'en',
  setScreen: (screen) => set({ screen }),
  setLocale: (locale) => set({ locale }),
}));
