import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Global storage key - settings are shared across all windows
const SETTINGS_STORAGE_KEY = 'acc-settings-global';

export interface NotificationSettings {
  enabled: boolean;              // Master toggle
  onConsoleComplete: boolean;    // Notify when agent console finishes
  onTerminalExit: boolean;       // Notify when terminal exits
  soundEnabled: boolean;         // Play sound with notification
  onlyWhenUnfocused: boolean;    // Only notify when app is not focused
}

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  onConsoleComplete: true,
  onTerminalExit: true,
  soundEnabled: false,
  onlyWhenUnfocused: true,
};

export type SettingsTab = 'shortcuts' | 'notifications';

export interface SettingsState {
  // Notification settings
  notifications: NotificationSettings;

  // UI state (not persisted)
  isSettingsOpen: boolean;
  activeTab: SettingsTab;

  // Actions
  setSettingsOpen: (open: boolean) => void;
  setActiveTab: (tab: SettingsTab) => void;
  updateNotifications: (partial: Partial<NotificationSettings>) => void;
  resetNotifications: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Default notification settings
      notifications: DEFAULT_NOTIFICATION_SETTINGS,

      // UI state
      isSettingsOpen: false,
      activeTab: 'shortcuts',

      // Actions
      setSettingsOpen: (open) => set({ isSettingsOpen: open }),

      setActiveTab: (tab) => set({ activeTab: tab }),

      updateNotifications: (partial) => set((state) => ({
        notifications: { ...state.notifications, ...partial },
      })),

      resetNotifications: () => set({ notifications: DEFAULT_NOTIFICATION_SETTINGS }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      // Only persist notification settings, not UI state
      partialize: (state) => ({
        notifications: state.notifications,
      }),
    }
  )
);

// Helper to get notification settings without React hook
export function getNotificationSettings(): NotificationSettings {
  return useSettingsStore.getState().notifications;
}
