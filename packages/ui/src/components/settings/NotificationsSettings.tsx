/**
 * NotificationsSettings - Settings panel for desktop notifications
 */

import { useState } from 'react';
import { Bell, Volume2, Monitor, Terminal, Bot, Settings, PlayCircle } from 'lucide-react';
import { useSettingsStore, type NotificationSettings } from '../../stores/settings';

interface ToggleProps {
  label: string;
  description: string;
  icon: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  indent?: boolean;
}

function Toggle({ label, description, icon, checked, onChange, disabled, indent }: ToggleProps) {
  return (
    <label
      className={`flex items-start gap-3 py-3 px-3 rounded-lg transition-colors cursor-pointer ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-zinc-800/50'
      } ${indent ? 'ml-6' : ''}`}
    >
      <div className="flex-shrink-0 mt-0.5 text-zinc-400">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-200">{label}</div>
        <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
      </div>
      <div className="flex-shrink-0">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={(e) => {
            e.preventDefault();
            if (!disabled) onChange(!checked);
          }}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            checked ? 'bg-violet-600' : 'bg-zinc-700'
          } ${disabled ? 'cursor-not-allowed' : ''}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              checked ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </label>
  );
}

export function NotificationsSettings() {
  const { notifications, updateNotifications } = useSettingsStore();
  const [testSent, setTestSent] = useState(false);

  const handleUpdate = (key: keyof NotificationSettings, value: boolean) => {
    updateNotifications({ [key]: value });
  };

  const handleOpenSystemSettings = () => {
    // Open macOS System Settings → Notifications
    window.electronAPI?.launcher?.browser('x-apple.systempreferences:com.apple.Notifications-Settings.extension');
  };

  const handleTestNotification = async () => {
    if (!window.electronAPI?.notifications?.show) {
      return;
    }

    try {
      await window.electronAPI.notifications.show({
        title: 'Test Notification',
        body: 'Notifications are working! 🎉',
        sound: notifications.soundEnabled,
        onlyWhenUnfocused: false, // Always show test notification
      });
      setTestSent(true);
      setTimeout(() => setTestSent(false), 3000);
    } catch (error) {
      console.error('Failed to send test notification:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Info text */}
      <div className="flex items-start gap-2 p-3 bg-zinc-800/50 rounded-lg text-sm">
        <Bell className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
        <p className="text-zinc-400">
          Get notified when long-running tasks complete. Notifications appear as native macOS alerts
          and can optionally play a sound.
        </p>
      </div>

      {/* Permission & Test buttons */}
      {window.electronAPI?.notifications && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleOpenSystemSettings}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors"
          >
            <Settings className="w-4 h-4" />
            Open System Settings
          </button>
          <button
            type="button"
            onClick={handleTestNotification}
            disabled={testSent}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              testSent
                ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-violet-600 hover:bg-violet-500 text-white'
            }`}
          >
            <PlayCircle className="w-4 h-4" />
            {testSent ? 'Sent!' : 'Test Notification'}
          </button>
        </div>
      )}

      {/* Master toggle */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          General
        </h3>
        <div className="space-y-1">
          <Toggle
            label="Enable Desktop Notifications"
            description="Show native macOS notifications when tasks complete"
            icon={<Bell className="w-4 h-4" />}
            checked={notifications.enabled}
            onChange={(v) => handleUpdate('enabled', v)}
          />
          <Toggle
            label="Only When App Not Focused"
            description="Skip notifications when any app window is active"
            icon={<Monitor className="w-4 h-4" />}
            checked={notifications.onlyWhenUnfocused}
            onChange={(v) => handleUpdate('onlyWhenUnfocused', v)}
            disabled={!notifications.enabled}
            indent
          />
          <Toggle
            label="Play Sound"
            description="Play a system sound with each notification"
            icon={<Volume2 className="w-4 h-4" />}
            checked={notifications.soundEnabled}
            onChange={(v) => handleUpdate('soundEnabled', v)}
            disabled={!notifications.enabled}
            indent
          />
        </div>
      </div>

      {/* Event types */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Notify When
        </h3>
        <div className="space-y-1">
          <Toggle
            label="Agent Console Completes"
            description="When an AI agent finishes its task"
            icon={<Bot className="w-4 h-4" />}
            checked={notifications.onConsoleComplete}
            onChange={(v) => handleUpdate('onConsoleComplete', v)}
            disabled={!notifications.enabled}
          />
          <Toggle
            label="Terminal Exits"
            description="When a terminal process finishes running"
            icon={<Terminal className="w-4 h-4" />}
            checked={notifications.onTerminalExit}
            onChange={(v) => handleUpdate('onTerminalExit', v)}
            disabled={!notifications.enabled}
          />
        </div>
      </div>
    </div>
  );
}

export default NotificationsSettings;
