/**
 * useNotifications - Hook for triggering desktop notifications
 *
 * This hook centralizes notification logic and respects user settings.
 * The actual notification display is handled by the main Electron process
 * to prevent duplicate notifications across multiple windows.
 */

import { useCallback } from 'react';
import { useSettingsStore } from '../stores/settings';

export type NotificationType = 'console-complete' | 'terminal-exit';

interface NotificationOptions {
  type: NotificationType;
  title: string;
  body: string;
  consoleId?: string;
}

export function useNotifications() {
  const notifications = useSettingsStore((state) => state.notifications);

  const showNotification = useCallback(async (options: NotificationOptions) => {
    // Check if notifications are enabled globally
    if (!notifications.enabled) {
      return { ok: true, skipped: true, reason: 'disabled' };
    }

    // Check specific event type settings
    if (options.type === 'console-complete' && !notifications.onConsoleComplete) {
      return { ok: true, skipped: true, reason: 'console-complete-disabled' };
    }
    if (options.type === 'terminal-exit' && !notifications.onTerminalExit) {
      return { ok: true, skipped: true, reason: 'terminal-exit-disabled' };
    }

    // Check if electronAPI is available (Electron environment)
    if (!window.electronAPI?.notifications) {
      // In browser mode, we can't show native notifications
      console.log('[Notifications] Not in Electron, skipping notification:', options.title);
      return { ok: false, error: 'not-electron' };
    }

    // Send notification request to main process
    // Main process handles focus check to prevent duplicates across windows
    try {
      const result = await window.electronAPI.notifications.show({
        title: options.title,
        body: options.body,
        sound: notifications.soundEnabled,
        onlyWhenUnfocused: notifications.onlyWhenUnfocused,
        consoleId: options.consoleId,
      });
      return result;
    } catch (error) {
      console.error('[Notifications] Failed to show notification:', error);
      return { ok: false, error: String(error) };
    }
  }, [notifications]);

  return { showNotification };
}

/**
 * Show notification without React hook (for use outside components)
 */
export async function showNotification(options: NotificationOptions) {
  const { notifications } = useSettingsStore.getState();

  // Check if notifications are enabled globally
  if (!notifications.enabled) {
    return { ok: true, skipped: true, reason: 'disabled' };
  }

  // Check specific event type settings
  if (options.type === 'console-complete' && !notifications.onConsoleComplete) {
    return { ok: true, skipped: true, reason: 'console-complete-disabled' };
  }
  if (options.type === 'terminal-exit' && !notifications.onTerminalExit) {
    return { ok: true, skipped: true, reason: 'terminal-exit-disabled' };
  }

  // Check if electronAPI is available
  if (!window.electronAPI?.notifications) {
    console.log('[Notifications] Not in Electron, skipping notification:', options.title);
    return { ok: false, error: 'not-electron' };
  }

  try {
    return await window.electronAPI.notifications.show({
      title: options.title,
      body: options.body,
      sound: notifications.soundEnabled,
      onlyWhenUnfocused: notifications.onlyWhenUnfocused,
      consoleId: options.consoleId,
    });
  } catch (error) {
    console.error('[Notifications] Failed to show notification:', error);
    return { ok: false, error: String(error) };
  }
}

export default useNotifications;
