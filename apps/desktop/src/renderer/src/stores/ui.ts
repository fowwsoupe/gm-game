import { create } from 'zustand';

/**
 * UI-only state (which screen is open, selections, filters).
 * Game state lives in the save file in the main process, never here.
 */
export type Screen = 'home' | 'standings' | 'roster';

interface UiState {
  screen: Screen;
  setScreen: (screen: Screen) => void;
}

export const useUi = create<UiState>((set) => ({
  screen: 'home',
  setScreen: (screen) => set({ screen }),
}));
