import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================================
// TYPES
// ============================================================================

/** Modifier keys that can be used in shortcuts */
export type ModifierKey = 'meta' | 'ctrl' | 'alt' | 'shift';

/** A keyboard shortcut definition */
export interface Shortcut {
  /** Unique identifier for this shortcut */
  id: string;
  /** Human-readable name for the shortcut */
  label: string;
  /** Description of what the shortcut does */
  description: string;
  /** Category for grouping shortcuts */
  category: ShortcutCategory;
  /** The key to press (e.g., 'k', 'Enter', 'ArrowUp') */
  key: string;
  /** Required modifier keys */
  modifiers: ModifierKey[];
  /** Display string (e.g., '⌘K', '⌘⇧N') - auto-generated if not provided */
  displayString?: string;
  /** Whether this shortcut can be customized by the user */
  customizable?: boolean;
  /** Whether this shortcut is enabled */
  enabled?: boolean;
}

/** Categories for organizing shortcuts */
export type ShortcutCategory =
  | 'navigation'    // Moving between widgets
  | 'command'       // Command palette related
  | 'console'       // Console actions
  | 'terminal'      // Terminal actions
  | 'layout'        // Layout management
  | 'general';      // General shortcuts

/** User customizations for shortcuts */
export interface ShortcutCustomization {
  /** New key binding */
  key?: string;
  /** New modifiers */
  modifiers?: ModifierKey[];
  /** Whether the shortcut is enabled */
  enabled?: boolean;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Generate a display string for a shortcut */
export function generateDisplayString(key: string, modifiers: ModifierKey[]): string {
  const symbols: Record<ModifierKey, string> = {
    meta: '⌘',
    ctrl: '⌃',
    alt: '⌥',
    shift: '⇧',
  };

  const keySymbols: Record<string, string> = {
    'Enter': '↵',
    'ArrowUp': '↑',
    'ArrowDown': '↓',
    'ArrowLeft': '←',
    'ArrowRight': '→',
    'Escape': 'Esc',
    'Backspace': '⌫',
    'Delete': '⌦',
    'Tab': '⇥',
    ' ': 'Space',
  };

  const modifierStr = modifiers
    .sort((a, b) => {
      const order: ModifierKey[] = ['ctrl', 'alt', 'shift', 'meta'];
      return order.indexOf(a) - order.indexOf(b);
    })
    .map(m => symbols[m])
    .join('');

  const keyStr = keySymbols[key] || key.toUpperCase();
  return modifierStr + keyStr;
}

/** Check if a keyboard event matches a shortcut */
export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (shortcut.enabled === false) return false;

  // Check key (case-insensitive for letter keys)
  const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const shortcutKey = shortcut.key.length === 1 ? shortcut.key.toLowerCase() : shortcut.key;
  if (eventKey !== shortcutKey) return false;

  // Check modifiers
  const hasCtrl = event.ctrlKey;
  const hasMeta = event.metaKey;
  const hasAlt = event.altKey;
  const hasShift = event.shiftKey;

  const needsCtrl = shortcut.modifiers.includes('ctrl');
  const needsMeta = shortcut.modifiers.includes('meta');
  const needsAlt = shortcut.modifiers.includes('alt');
  const needsShift = shortcut.modifiers.includes('shift');

  // For meta/ctrl, allow either (cross-platform support)
  const metaOrCtrl = hasMeta || hasCtrl;
  const needsMetaOrCtrl = needsMeta || needsCtrl;

  if (needsMetaOrCtrl !== metaOrCtrl) return false;
  if (needsAlt !== hasAlt) return false;
  if (needsShift !== hasShift) return false;

  return true;
}

// ============================================================================
// DEFAULT SHORTCUTS
// ============================================================================

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  // Command Palette (CMD+P is primary, CMD+Shift+K is alternative)
  {
    id: 'command-palette-toggle',
    label: 'Open Command Palette',
    description: 'Toggle the command palette',
    category: 'command',
    key: 'p',
    modifiers: ['meta'],
    customizable: true,
  },
  {
    id: 'command-palette-toggle-alt',
    label: 'Open Command Palette (Alt)',
    description: 'Toggle the command palette with Shift+K',
    category: 'command',
    key: 'k',
    modifiers: ['meta', 'shift'],
    customizable: true,
  },

  // Widget Navigation (Vim-style with CMD)
  {
    id: 'focus-left',
    label: 'Focus Left',
    description: 'Move focus to the widget on the left',
    category: 'navigation',
    key: 'h',
    modifiers: ['meta'],
    customizable: true,
  },
  {
    id: 'focus-down',
    label: 'Focus Down',
    description: 'Move focus to the widget below',
    category: 'navigation',
    key: 'j',
    modifiers: ['meta'],
    customizable: true,
  },
  {
    id: 'focus-up',
    label: 'Focus Up',
    description: 'Move focus to the widget above',
    category: 'navigation',
    key: 'k',
    modifiers: ['meta'],
    customizable: true,
  },
  {
    id: 'focus-right',
    label: 'Focus Right',
    description: 'Move focus to the widget on the right',
    category: 'navigation',
    key: 'l',
    modifiers: ['meta'],
    customizable: true,
  },

  // Console/Terminal Actions
  {
    id: 'new-console',
    label: 'New Console',
    description: 'Open a new agent console',
    category: 'console',
    key: 'n',
    modifiers: ['meta'],
    customizable: true,
  },
  {
    id: 'new-terminal',
    label: 'New Terminal',
    description: 'Open a new terminal',
    category: 'terminal',
    key: 't',
    modifiers: ['meta'],
    customizable: true,
  },
  {
    id: 'close-widget',
    label: 'Close Widget',
    description: 'Close the focused widget',
    category: 'general',
    key: 'w',
    modifiers: ['meta'],
    customizable: true,
  },
  {
    id: 'maximize-widget',
    label: 'Maximize/Restore Widget',
    description: 'Toggle maximize for the focused widget',
    category: 'layout',
    key: 'Enter',
    modifiers: ['meta'],
    customizable: true,
  },
  {
    id: 'create-task',
    label: 'Create Task',
    description: 'Create a new task',
    category: 'general',
    key: 'n',
    modifiers: ['meta', 'shift'],
    customizable: true,
  },

  // Escape actions (not customizable)
  {
    id: 'escape',
    label: 'Escape',
    description: 'Close palette / restore maximized / clear focus',
    category: 'general',
    key: 'Escape',
    modifiers: [],
    customizable: false,
  },

  // Arrow key navigation (keeping for compatibility)
  {
    id: 'arrow-up',
    label: 'Navigate Up',
    description: 'Move focus up (when no widget focused)',
    category: 'navigation',
    key: 'ArrowUp',
    modifiers: [],
    customizable: false,
  },
  {
    id: 'arrow-down',
    label: 'Navigate Down',
    description: 'Move focus down (when no widget focused)',
    category: 'navigation',
    key: 'ArrowDown',
    modifiers: [],
    customizable: false,
  },
  {
    id: 'arrow-left',
    label: 'Navigate Left',
    description: 'Move focus left (when no widget focused)',
    category: 'navigation',
    key: 'ArrowLeft',
    modifiers: [],
    customizable: false,
  },
  {
    id: 'arrow-right',
    label: 'Navigate Right',
    description: 'Move focus right (when no widget focused)',
    category: 'navigation',
    key: 'ArrowRight',
    modifiers: [],
    customizable: false,
  },

  // View shortcuts menu
  {
    id: 'show-shortcuts',
    label: 'Keyboard Shortcuts',
    description: 'Show keyboard shortcuts menu',
    category: 'general',
    key: '/',
    modifiers: ['meta'],
    customizable: true,
  },

  // View settings
  {
    id: 'show-settings',
    label: 'Settings',
    description: 'Open application settings',
    category: 'general',
    key: ',',
    modifiers: ['meta'],
    customizable: true,
  },
];

// ============================================================================
// STORE
// ============================================================================

interface ShortcutsState {
  /** User customizations (sparse - only stores differences from defaults) */
  customizations: Record<string, ShortcutCustomization>;

  /** Whether the shortcuts menu is open */
  isMenuOpen: boolean;

  /** Get a shortcut by ID (with user customizations applied) */
  getShortcut: (id: string) => Shortcut | undefined;

  /** Get all shortcuts (with user customizations applied) */
  getAllShortcuts: () => Shortcut[];

  /** Get shortcuts by category */
  getShortcutsByCategory: (category: ShortcutCategory) => Shortcut[];

  /** Customize a shortcut */
  customizeShortcut: (id: string, customization: ShortcutCustomization) => void;

  /** Reset a shortcut to its default */
  resetShortcut: (id: string) => void;

  /** Reset all shortcuts to defaults */
  resetAllShortcuts: () => void;

  /** Check if a shortcut has been customized */
  isCustomized: (id: string) => boolean;

  /** Open/close shortcuts menu */
  setMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;

  /** Find shortcut by keyboard event */
  findMatchingShortcut: (event: KeyboardEvent) => Shortcut | undefined;
}

export const useShortcutsStore = create<ShortcutsState>()(
  persist(
    (set, get) => ({
      customizations: {},
      isMenuOpen: false,

      getShortcut: (id) => {
        const defaultShortcut = DEFAULT_SHORTCUTS.find(s => s.id === id);
        if (!defaultShortcut) return undefined;

        const customization = get().customizations[id];
        if (!customization) {
          return {
            ...defaultShortcut,
            displayString: defaultShortcut.displayString || generateDisplayString(defaultShortcut.key, defaultShortcut.modifiers),
          };
        }

        const merged: Shortcut = {
          ...defaultShortcut,
          key: customization.key ?? defaultShortcut.key,
          modifiers: customization.modifiers ?? defaultShortcut.modifiers,
          enabled: customization.enabled ?? defaultShortcut.enabled,
        };
        merged.displayString = generateDisplayString(merged.key, merged.modifiers);
        return merged;
      },

      getAllShortcuts: () => {
        return DEFAULT_SHORTCUTS.map(s => get().getShortcut(s.id)!);
      },

      getShortcutsByCategory: (category) => {
        return get().getAllShortcuts().filter(s => s.category === category);
      },

      customizeShortcut: (id, customization) => {
        const defaultShortcut = DEFAULT_SHORTCUTS.find(s => s.id === id);
        if (!defaultShortcut || defaultShortcut.customizable === false) return;

        set(state => ({
          customizations: {
            ...state.customizations,
            [id]: {
              ...state.customizations[id],
              ...customization,
            },
          },
        }));
      },

      resetShortcut: (id) => {
        set(state => {
          const { [id]: _, ...rest } = state.customizations;
          return { customizations: rest };
        });
      },

      resetAllShortcuts: () => {
        set({ customizations: {} });
      },

      isCustomized: (id) => {
        return !!get().customizations[id];
      },

      setMenuOpen: (open) => set({ isMenuOpen: open }),
      toggleMenu: () => set(state => ({ isMenuOpen: !state.isMenuOpen })),

      findMatchingShortcut: (event) => {
        const shortcuts = get().getAllShortcuts();
        return shortcuts.find(s => matchesShortcut(event, s));
      },
    }),
    {
      name: 'shortcuts-storage',
      partialize: (state) => ({ customizations: state.customizations }),
    }
  )
);

// ============================================================================
// CATEGORY LABELS
// ============================================================================

export const SHORTCUT_CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  navigation: 'Navigation',
  command: 'Command Palette',
  console: 'Console',
  terminal: 'Terminal',
  layout: 'Layout',
  general: 'General',
};
