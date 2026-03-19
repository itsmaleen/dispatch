import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Command } from '../lib/commands/types';

interface SubcommandStackItem {
  parentCommand: Command;
  parentLabel: string;
}

interface InputModeState {
  active: boolean;
  placeholder: string;
  onSubmit: ((value: string) => void) | null;
}

/** Semantic search result from the server */
export interface SemanticResult {
  commandId: string;
  score: number;
}

interface CommandPaletteState {
  // UI state (ephemeral - not persisted)
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  inputValue: string;

  // Subcommand navigation
  subcommandStack: SubcommandStackItem[];

  // Input mode (for "Create Task" etc.)
  inputMode: InputModeState;

  // Semantic search state
  semanticResults: SemanticResult[];
  isSemanticLoading: boolean;

  // Persisted: recent selections per command (commandId -> subcommandId)
  recentSelections: Record<string, string>;

  // Actions
  open: (options?: { preselectedCommandId?: string }) => void;
  close: () => void;
  toggle: () => void;
  setQuery: (query: string) => void;
  setSelectedIndex: (index: number) => void;
  moveSelection: (delta: number, maxIndex: number) => void;

  // Subcommand navigation
  pushSubcommand: (command: Command) => void;
  popSubcommand: () => void;
  clearSubcommandStack: () => void;

  // Input mode
  enterInputMode: (placeholder: string, onSubmit: (value: string) => void) => void;
  exitInputMode: () => void;
  setInputValue: (value: string) => void;

  // Recent selections
  setRecentSelection: (commandId: string, subcommandId: string) => void;
  getRecentSelection: (commandId: string) => string | undefined;

  // Semantic search
  setSemanticResults: (results: SemanticResult[]) => void;
  setSemanticLoading: (loading: boolean) => void;

  // Helper to get preselected command ID (set during open)
  preselectedCommandId: string | null;
}

export const useCommandPaletteStore = create<CommandPaletteState>()(
  persist(
    (set, get) => ({
      // Initial state
      isOpen: false,
      query: '',
      selectedIndex: 0,
      inputValue: '',
      subcommandStack: [],
      inputMode: {
        active: false,
        placeholder: '',
        onSubmit: null,
      },
      semanticResults: [],
      isSemanticLoading: false,
      recentSelections: {},
      preselectedCommandId: null,

      // Actions
      open: (options) => {
        set({
          isOpen: true,
          query: '',
          selectedIndex: 0,
          inputValue: '',
          subcommandStack: [],
          inputMode: { active: false, placeholder: '', onSubmit: null },
          preselectedCommandId: options?.preselectedCommandId ?? null,
        });
      },

      close: () => {
        set({
          isOpen: false,
          query: '',
          selectedIndex: 0,
          inputValue: '',
          subcommandStack: [],
          inputMode: { active: false, placeholder: '', onSubmit: null },
          semanticResults: [],
          isSemanticLoading: false,
          preselectedCommandId: null,
        });
      },

      toggle: () => {
        const { isOpen, open, close } = get();
        if (isOpen) {
          close();
        } else {
          open();
        }
      },

      setQuery: (query) => {
        set({ query, selectedIndex: 0 });
      },

      setSelectedIndex: (index) => {
        set({ selectedIndex: index });
      },

      moveSelection: (delta, maxIndex) => {
        set((state) => {
          let newIndex = state.selectedIndex + delta;
          if (newIndex < 0) newIndex = maxIndex;
          if (newIndex > maxIndex) newIndex = 0;
          return { selectedIndex: newIndex };
        });
      },

      // Subcommand navigation
      pushSubcommand: (command) => {
        set((state) => ({
          subcommandStack: [
            ...state.subcommandStack,
            { parentCommand: command, parentLabel: command.label },
          ],
          query: '',
          selectedIndex: 0,
        }));
      },

      popSubcommand: () => {
        set((state) => ({
          subcommandStack: state.subcommandStack.slice(0, -1),
          query: '',
          selectedIndex: 0,
        }));
      },

      clearSubcommandStack: () => {
        set({ subcommandStack: [], query: '', selectedIndex: 0 });
      },

      // Input mode
      enterInputMode: (placeholder, onSubmit) => {
        set({
          inputMode: { active: true, placeholder, onSubmit },
          inputValue: '',
        });
      },

      exitInputMode: () => {
        set({
          inputMode: { active: false, placeholder: '', onSubmit: null },
          inputValue: '',
        });
      },

      setInputValue: (value) => {
        set({ inputValue: value });
      },

      // Recent selections
      setRecentSelection: (commandId, subcommandId) => {
        set((state) => ({
          recentSelections: {
            ...state.recentSelections,
            [commandId]: subcommandId,
          },
        }));
      },

      getRecentSelection: (commandId) => {
        return get().recentSelections[commandId];
      },

      // Semantic search
      setSemanticResults: (results) => {
        set({ semanticResults: results });
      },

      setSemanticLoading: (loading) => {
        set({ isSemanticLoading: loading });
      },
    }),
    {
      name: 'command-palette-storage',
      // Only persist recentSelections
      partialize: (state) => ({
        recentSelections: state.recentSelections,
      }),
    }
  )
);
