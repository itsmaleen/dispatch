# Settings & Notifications System

This document describes the Settings panel and desktop notification system for Merry.

## Overview

The Settings system provides a unified modal for configuring application preferences, with the initial focus on desktop notifications for macOS.

## Accessing Settings

Settings can be accessed via:

1. **Keyboard shortcut**: `⌘,` (Command + comma)
2. **Command palette**: `⌘K` → type "settings"
3. **macOS app menu**: Merry → Settings...

## Settings Panel

The Settings panel is a modal dialog with a tabbed interface:

- **Shortcuts**: View and reference keyboard shortcuts
- **Notifications**: Configure desktop notification preferences

### Files

| File | Description |
|------|-------------|
| `src/components/settings/SettingsPanel.tsx` | Main modal component with tabs |
| `src/components/settings/NotificationsSettings.tsx` | Notification preferences UI |
| `src/components/settings/ShortcutsContent.tsx` | Shortcuts reference panel |
| `src/stores/settings.ts` | Zustand store for settings state |

## Notification System

### Features

1. **Native macOS notifications** - Uses Electron's `Notification` API for native alerts
2. **Sound support** - Optional notification sound (uses macOS default notification sound)
3. **Focus-aware** - Can skip notifications when app is focused
4. **Click-to-focus** - Clicking a notification focuses the app and highlights the relevant console
5. **Console pulse highlight** - 2-second purple pulse animation on the completed console

### Settings Options

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Desktop Notifications | `true` | Master toggle for all notifications |
| Only When App Not Focused | `true` | Skip notifications when any app window is active |
| Play Sound | `false` | Play macOS notification sound |
| Agent Console Completes | `true` | Notify when an AI agent finishes |
| Terminal Exits | `true` | Notify when a terminal process exits |

### Buttons

- **Open System Settings** - Opens macOS System Settings → Notifications to configure permissions
- **Test Notification** - Sends a test notification to verify the system is working

## Architecture

### IPC Flow

```
Renderer (React)                    Main (Electron)
      │                                   │
      │  notification:show ──────────────>│
      │  {title, body, sound, consoleId}  │
      │                                   │
      │                          Check focus state
      │                          Create Notification
      │                          Register click handler
      │                                   │
      │<────────────── notification:clicked│
      │  {consoleId}                      │
      │                                   │
  Highlight console                       │
  with purple pulse                       │
```

### Files

| File | Description |
|------|-------------|
| `electron/main.ts` | IPC handlers for notifications |
| `electron/preload.ts` | Exposes notification API to renderer |
| `src/hooks/useNotifications.ts` | React hook for triggering notifications |
| `src/types/electron.d.ts` | TypeScript types for Electron API |

### Storage

Settings are persisted to `localStorage` with the key `acc-settings-global`. Only notification preferences are persisted; UI state (like `isSettingsOpen`) is not.

## Usage

### From React Components

```typescript
import { useNotifications } from '../hooks/useNotifications';

function MyComponent() {
  const { showNotification } = useNotifications();

  const handleComplete = () => {
    showNotification({
      type: 'console-complete',
      title: 'Agent Completed',
      body: 'Claude has finished the task',
      consoleId: 'console-123', // Optional: for click-to-focus
    });
  };
}
```

### From Outside React

```typescript
import { showNotification } from '../hooks/useNotifications';

// Can be called anywhere
showNotification({
  type: 'terminal-exit',
  title: 'Terminal Exited',
  body: 'Process completed with code 0',
});
```

## macOS Permissions

On macOS, notifications require user permission. The permission prompt is triggered automatically when the first notification is shown. Users can also:

1. Click "Open System Settings" to navigate directly to notification preferences
2. Click "Test Notification" to trigger the permission prompt and verify notifications work

## Console Highlight Animation

When a notification is clicked, the corresponding console receives a 2-second purple pulse animation. This uses the existing CSS animations:

- `terminal-outer-highlight-pulse` - Outer border pulse
- `terminal-title-highlight-pulse` - Title bar pulse
- `terminal-tab-highlight-pulse` - Minimized tab pulse (if applicable)

The highlight is applied by setting `highlightedTerminalId` in the Workspace component, which is cleared after 2 seconds via `setTimeout`.
