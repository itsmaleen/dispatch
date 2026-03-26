/**
 * SettingsPanel - Main settings modal with tabbed interface
 */

import { useCallback, useEffect } from 'react';
import { X, Settings, Keyboard, Bell } from 'lucide-react';
import { useSettingsStore, type SettingsTab } from '../../stores/settings';
import { NotificationsSettings } from './NotificationsSettings';
import { ShortcutsContent } from './ShortcutsContent';

interface TabButtonProps {
  tab: SettingsTab;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}

function TabButton({ label, icon, active, onClick }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active
          ? 'bg-zinc-800 text-zinc-100'
          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function SettingsPanel() {
  const { isSettingsOpen, setSettingsOpen, activeTab, setActiveTab } = useSettingsStore();

  const handleClose = useCallback(() => {
    setSettingsOpen(false);
  }, [setSettingsOpen]);

  // ESC key to close modal
  useEffect(() => {
    if (!isSettingsOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen, handleClose]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }, [handleClose]);

  if (!isSettingsOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[10vh] z-50"
      onClick={handleOverlayClick}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-violet-400" />
            <h2 className="text-lg font-semibold text-zinc-100">Settings</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="px-4 py-2 border-b border-zinc-800 flex gap-2 flex-shrink-0">
          <TabButton
            tab="shortcuts"
            label="Shortcuts"
            icon={<Keyboard className="w-4 h-4" />}
            active={activeTab === 'shortcuts'}
            onClick={() => setActiveTab('shortcuts')}
          />
          <TabButton
            tab="notifications"
            label="Notifications"
            icon={<Bell className="w-4 h-4" />}
            active={activeTab === 'notifications'}
            onClick={() => setActiveTab('notifications')}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'shortcuts' && <ShortcutsContent />}
          {activeTab === 'notifications' && <NotificationsSettings />}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-zinc-800 text-xs text-zinc-500 flex items-center justify-between flex-shrink-0">
          <span>Press <kbd className="bg-zinc-800 px-1 rounded">Esc</kbd> to close</span>
          <span>
            <kbd className="bg-zinc-800 px-1 rounded">⌘</kbd> + <kbd className="bg-zinc-800 px-1 rounded">,</kbd> to toggle
          </span>
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
