import { create } from 'zustand';
import { PaletteCommand } from '../types/palette';

export type PaletteMode = 'commands' | 'files' | 'symbols';

export interface PaletteState {
  isOpen: boolean;
  mode: PaletteMode;
  query: string;
  selectedIndex: number;
  commands: PaletteCommand[];

  // Actions
  open: (mode?: PaletteMode, initialQuery?: string) => void;
  close: () => void;
  toggle: (mode?: PaletteMode) => void;
  setMode: (mode: PaletteMode) => void;
  setQuery: (query: string) => void;
  setSelectedIndex: (index: number) => void;
  selectNext: (totalCount: number) => void;
  selectPrevious: (totalCount: number) => void;
  registerCommand: (command: PaletteCommand) => () => void;
  registerCommands: (commands: PaletteCommand[]) => () => void;
  clearCommands: () => void;
}

export const usePaletteStore = create<PaletteState>((set, get) => ({
  isOpen: false,
  mode: 'commands',
  query: '',
  selectedIndex: 0,
  commands: [],

  open: (mode = 'commands', initialQuery = '') => {
    set({
      isOpen: true,
      mode,
      query: initialQuery,
      selectedIndex: 0,
    });
  },

  close: () => {
    set({
      isOpen: false,
      query: '',
      selectedIndex: 0,
    });
  },

  toggle: (mode) => {
    const currentOpen = get().isOpen;
    if (currentOpen) {
      get().close();
    } else {
      get().open(mode);
    }
  },

  setMode: (mode) => {
    set({ mode, selectedIndex: 0 });
  },

  setQuery: (query) => {
    // If user types '>' at start while in 'files' mode, automatically switch to 'commands'
    // If user backspaces '>' while in 'commands' mode, switch to 'files'
    let nextMode = get().mode;
    let effectiveQuery = query;

    if (query.startsWith('>')) {
      nextMode = 'commands';
      effectiveQuery = query.slice(1);
    }

    set({
      query: effectiveQuery,
      mode: nextMode,
      selectedIndex: 0,
    });
  },

  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),

  selectNext: (totalCount) => {
    if (totalCount <= 0) return;
    set((state) => ({
      selectedIndex: (state.selectedIndex + 1) % totalCount,
    }));
  },

  selectPrevious: (totalCount) => {
    if (totalCount <= 0) return;
    set((state) => ({
      selectedIndex: (state.selectedIndex - 1 + totalCount) % totalCount,
    }));
  },

  registerCommand: (command) => {
    set((state) => {
      // Remove any existing command with same id to allow updating
      const filtered = state.commands.filter((c) => c.id !== command.id);
      return { commands: [...filtered, command] };
    });

    // Return unregister callback
    return () => {
      set((state) => ({
        commands: state.commands.filter((c) => c.id !== command.id),
      }));
    };
  },

  registerCommands: (newCommands) => {
    set((state) => {
      const newIds = new Set(newCommands.map((c) => c.id));
      const existingFiltered = state.commands.filter((c) => !newIds.has(c.id));
      return { commands: [...existingFiltered, ...newCommands] };
    });

    return () => {
      const newIds = new Set(newCommands.map((c) => c.id));
      set((state) => ({
        commands: state.commands.filter((c) => !newIds.has(c.id)),
      }));
    };
  },

  clearCommands: () => set({ commands: [] }),
}));
