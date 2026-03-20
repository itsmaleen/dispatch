/**
 * ShortcutsMenu - Modal for viewing and editing keyboard shortcuts
 */

import { useCallback, useState, useRef, useEffect } from 'react';
import { X, RotateCcw, Keyboard, Check, AlertTriangle } from 'lucide-react';
import {
  useShortcutsStore,
  SHORTCUT_CATEGORY_LABELS,
  type Shortcut,
  type ShortcutCategory,
  type ModifierKey,
  generateDisplayString,
} from '../../stores/shortcuts';

// ============================================================================
// SHORTCUT ITEM COMPONENT
// ============================================================================

interface ShortcutItemProps {
  shortcut: Shortcut;
  isEditing: boolean;
  onStartEdit: () => void;
  onSave: (key: string, modifiers: ModifierKey[]) => void;
  onCancel: () => void;
  onReset: () => void;
  isCustomized: boolean;
}

function ShortcutItem({
  shortcut,
  isEditing,
  onStartEdit,
  onSave,
  onCancel,
  onReset,
  isCustomized,
}: ShortcutItemProps) {
  const [capturedKey, setCapturedKey] = useState<string | null>(null);
  const [capturedModifiers, setCapturedModifiers] = useState<ModifierKey[]>([]);
  const inputRef = useRef<HTMLDivElement>(null);

  // Auto-focus the input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  // Reset captured state when editing starts
  useEffect(() => {
    if (isEditing) {
      setCapturedKey(null);
      setCapturedModifiers([]);
    }
  }, [isEditing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Escape cancels editing
    if (e.key === 'Escape') {
      onCancel();
      return;
    }

    // Capture modifiers
    const modifiers: ModifierKey[] = [];
    if (e.metaKey) modifiers.push('meta');
    if (e.ctrlKey) modifiers.push('ctrl');
    if (e.altKey) modifiers.push('alt');
    if (e.shiftKey) modifiers.push('shift');

    // Don't capture if only modifier keys are pressed
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) {
      setCapturedModifiers(modifiers);
      return;
    }

    // Capture the key
    setCapturedKey(e.key);
    setCapturedModifiers(modifiers);
  }, [onCancel]);

  const handleSave = useCallback(() => {
    if (capturedKey) {
      onSave(capturedKey, capturedModifiers);
    }
  }, [capturedKey, capturedModifiers, onSave]);

  const displayString = shortcut.displayString || generateDisplayString(shortcut.key, shortcut.modifiers);
  const newDisplayString = capturedKey ? generateDisplayString(capturedKey, capturedModifiers) : null;

  return (
    <div
      className={`flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${
        isEditing ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
      } ${shortcut.enabled === false ? 'opacity-50' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-200">{shortcut.label}</span>
          {isCustomized && (
            <span className="text-[10px] px-1.5 py-0.5 bg-violet-500/20 text-violet-400 rounded">
              Modified
            </span>
          )}
          {shortcut.enabled === false && (
            <span className="text-[10px] px-1.5 py-0.5 bg-zinc-700 text-zinc-500 rounded">
              Disabled
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 truncate">{shortcut.description}</p>
      </div>

      <div className="flex items-center gap-2 ml-4">
        {isEditing ? (
          <>
            <div
              ref={inputRef}
              tabIndex={0}
              onKeyDown={handleKeyDown}
              className="px-3 py-1.5 bg-zinc-900 border border-violet-500 rounded text-sm font-mono text-zinc-200 min-w-[100px] text-center focus:outline-none ring-1 ring-violet-500/50"
            >
              {newDisplayString || 'Press keys...'}
            </div>
            <button
              onClick={handleSave}
              disabled={!capturedKey}
              className="p-1.5 text-green-400 hover:bg-green-500/20 rounded disabled:opacity-30 disabled:cursor-not-allowed"
              title="Save"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={onCancel}
              className="p-1.5 text-zinc-400 hover:bg-zinc-700 rounded"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <kbd
              className={`px-2 py-1 text-xs font-mono rounded ${
                shortcut.customizable !== false
                  ? 'bg-zinc-800 text-zinc-300 cursor-pointer hover:bg-zinc-700'
                  : 'bg-zinc-900 text-zinc-500 cursor-default'
              }`}
              onClick={() => shortcut.customizable !== false && onStartEdit()}
              title={shortcut.customizable !== false ? 'Click to edit' : 'Cannot be customized'}
            >
              {displayString}
            </kbd>
            {isCustomized && (
              <button
                onClick={onReset}
                className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded"
                title="Reset to default"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SHORTCUTS MENU COMPONENT
// ============================================================================

export function ShortcutsMenu() {
  const {
    isMenuOpen,
    setMenuOpen,
    getAllShortcuts,
    getShortcutsByCategory,
    customizeShortcut,
    resetShortcut,
    resetAllShortcuts,
    isCustomized,
  } = useShortcutsStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleClose = useCallback(() => {
    setMenuOpen(false);
    setEditingId(null);
  }, [setMenuOpen]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }, [handleClose]);

  const handleSave = useCallback((id: string, key: string, modifiers: ModifierKey[]) => {
    customizeShortcut(id, { key, modifiers });
    setEditingId(null);
  }, [customizeShortcut]);

  const handleReset = useCallback((id: string) => {
    resetShortcut(id);
  }, [resetShortcut]);

  const handleResetAll = useCallback(() => {
    resetAllShortcuts();
    setShowResetConfirm(false);
  }, [resetAllShortcuts]);

  if (!isMenuOpen) return null;

  // Group shortcuts by category
  const categories: ShortcutCategory[] = ['command', 'navigation', 'console', 'terminal', 'layout', 'general'];

  const hasAnyCustomizations = getAllShortcuts().some(s => isCustomized(s.id));

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[10vh] z-50"
      onClick={handleOverlayClick}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <Keyboard className="w-5 h-5 text-violet-400" />
            <h2 className="text-lg font-semibold text-zinc-100">Keyboard Shortcuts</h2>
          </div>
          <div className="flex items-center gap-2">
            {hasAnyCustomizations && (
              showResetConfirm ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-zinc-400">Reset all?</span>
                  <button
                    onClick={handleResetAll}
                    className="px-2 py-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setShowResetConfirm(false)}
                    className="px-2 py-1 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 rounded"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset All
                </button>
              )
            )}
            <button
              onClick={handleClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Help text */}
          <div className="flex items-start gap-2 p-3 bg-zinc-800/50 rounded-lg text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-zinc-400">
              Click on a shortcut key to customize it. Press the new key combination you want to use, then click the checkmark to save.
              Some shortcuts cannot be customized.
            </p>
          </div>

          {categories.map(category => {
            const shortcuts = getShortcutsByCategory(category);
            if (shortcuts.length === 0) return null;

            return (
              <div key={category}>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  {SHORTCUT_CATEGORY_LABELS[category]}
                </h3>
                <div className="space-y-1">
                  {shortcuts.map(shortcut => (
                    <ShortcutItem
                      key={shortcut.id}
                      shortcut={shortcut}
                      isEditing={editingId === shortcut.id}
                      onStartEdit={() => setEditingId(shortcut.id)}
                      onSave={(key, modifiers) => handleSave(shortcut.id, key, modifiers)}
                      onCancel={() => setEditingId(null)}
                      onReset={() => handleReset(shortcut.id)}
                      isCustomized={isCustomized(shortcut.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-zinc-800 text-xs text-zinc-500 flex items-center justify-between flex-shrink-0">
          <span>Press <kbd className="bg-zinc-800 px-1 rounded">Esc</kbd> to close</span>
          <span>
            <kbd className="bg-zinc-800 px-1 rounded">⌘</kbd> + <kbd className="bg-zinc-800 px-1 rounded">/</kbd> to toggle
          </span>
        </div>
      </div>
    </div>
  );
}

export default ShortcutsMenu;
