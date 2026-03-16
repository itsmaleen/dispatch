import { useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, ChevronRight, ArrowLeft } from 'lucide-react';
import { useCommandPaletteStore } from '../../stores/command-palette';
import { commandRegistry } from '../../lib/commands/registry';
import { CommandGroup } from './CommandGroup';
import { CommandItem } from './CommandItem';
import type { Command } from '../../lib/commands/types';

export function CommandPalette() {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const {
    isOpen,
    query,
    selectedIndex,
    subcommandStack,
    inputMode,
    inputValue,
    preselectedCommandId,
    close,
    setQuery,
    setSelectedIndex,
    moveSelection,
    pushSubcommand,
    popSubcommand,
    enterInputMode,
    exitInputMode,
    setInputValue,
    setRecentSelection,
    getRecentSelection,
  } = useCommandPaletteStore();

  // Get current commands based on subcommand stack
  const currentCommands = useMemo(() => {
    if (subcommandStack.length > 0) {
      const parent = subcommandStack[subcommandStack.length - 1].parentCommand;
      if (parent.action.type === 'subcommand') {
        return parent.action.getCommands();
      }
    }
    return commandRegistry.search(query);
  }, [query, subcommandStack]);

  // Filter commands when in subcommand mode
  const filteredCommands = useMemo(() => {
    if (subcommandStack.length > 0 && query) {
      const queryLower = query.toLowerCase();
      return currentCommands.filter(
        (cmd) =>
          cmd.label.toLowerCase().includes(queryLower) ||
          cmd.description?.toLowerCase().includes(queryLower) ||
          cmd.keywords?.some((k) => k.toLowerCase().includes(queryLower))
      );
    }
    return currentCommands;
  }, [currentCommands, query, subcommandStack.length]);

  // Group commands (only at root level)
  const groups = useMemo(() => {
    if (subcommandStack.length > 0) return null;
    return commandRegistry.getGroups(filteredCommands);
  }, [filteredCommands, subcommandStack.length]);

  // Flat list for navigation
  const flatCommands = useMemo(() => {
    if (groups) {
      return groups.flatMap((g) => g.commands);
    }
    return filteredCommands;
  }, [groups, filteredCommands]);

  // Handle preselected command on open
  useEffect(() => {
    if (isOpen && preselectedCommandId) {
      const command = commandRegistry.getById(preselectedCommandId);
      if (command) {
        // If it's a subcommand type, enter subcommand mode immediately
        if (command.action.type === 'subcommand') {
          pushSubcommand(command);
        }
      }
    }
  }, [isOpen, preselectedCommandId, pushSubcommand]);

  // Set initial selection based on recent selection (for subcommand mode)
  useEffect(() => {
    if (subcommandStack.length > 0) {
      const parentCommand = subcommandStack[subcommandStack.length - 1].parentCommand;
      const recentId = getRecentSelection(parentCommand.id);

      if (recentId) {
        const index = filteredCommands.findIndex((cmd) => cmd.id === recentId);
        if (index >= 0) {
          setSelectedIndex(index);
        }
      }
      // If no recent selection, keep selectedIndex at 0 (no pre-selection means first item)
    }
  }, [subcommandStack, filteredCommands, getRecentSelection, setSelectedIndex]);

  // Focus input when palette opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure modal is rendered
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen, inputMode.active]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.querySelector('[data-selected="true"]');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Execute a command
  const executeCommand = useCallback(
    (command: Command) => {
      // Record selection for subcommand parent
      if (subcommandStack.length > 0) {
        const parentCommand = subcommandStack[subcommandStack.length - 1].parentCommand;
        setRecentSelection(parentCommand.id, command.id);
      }

      switch (command.action.type) {
        case 'execute':
          command.action.handler();
          close();
          break;
        case 'subcommand':
          pushSubcommand(command);
          break;
        case 'input':
          enterInputMode(command.action.placeholder, command.action.onSubmit);
          break;
      }
    },
    [close, pushSubcommand, enterInputMode, setRecentSelection, subcommandStack]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveSelection(1, flatCommands.length - 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveSelection(-1, flatCommands.length - 1);
          break;
        case 'Enter':
          e.preventDefault();
          if (inputMode.active) {
            if (inputMode.onSubmit && inputValue.trim()) {
              inputMode.onSubmit(inputValue.trim());
              close();
            }
          } else if (flatCommands[selectedIndex]) {
            executeCommand(flatCommands[selectedIndex]);
          }
          break;
        case 'Backspace':
          if (query === '' && subcommandStack.length > 0) {
            e.preventDefault();
            popSubcommand();
          }
          break;
        case 'Escape':
          e.preventDefault();
          if (inputMode.active) {
            exitInputMode();
          } else if (subcommandStack.length > 0) {
            popSubcommand();
          } else {
            close();
          }
          break;
      }
    },
    [
      query,
      selectedIndex,
      flatCommands,
      subcommandStack,
      inputMode,
      inputValue,
      moveSelection,
      popSubcommand,
      executeCommand,
      exitInputMode,
      close,
    ]
  );

  // Handle click outside
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        close();
      }
    },
    [close]
  );

  if (!isOpen) return null;

  // Build breadcrumb path
  const breadcrumbPath = subcommandStack.map((item) => item.parentLabel);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[15vh] z-50"
      onClick={handleOverlayClick}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-xl overflow-hidden shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        {/* Breadcrumb (when in subcommand mode) */}
        {breadcrumbPath.length > 0 && (
          <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-1 text-sm">
            <button
              onClick={popSubcommand}
              className="p-1 -ml-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            {breadcrumbPath.map((label, index) => (
              <span key={index} className="flex items-center gap-1">
                {index > 0 && <ChevronRight className="w-3 h-3 text-zinc-600" />}
                <span className="text-zinc-300">{label}</span>
              </span>
            ))}
          </div>
        )}

        {/* Search input */}
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3">
          <Search className="w-5 h-5 text-zinc-500 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={inputMode.active ? inputValue : query}
            onChange={(e) =>
              inputMode.active
                ? setInputValue(e.target.value)
                : setQuery(e.target.value)
            }
            placeholder={
              inputMode.active
                ? inputMode.placeholder
                : subcommandStack.length > 0
                  ? 'Search...'
                  : 'Type a command or search...'
            }
            className="flex-1 bg-transparent text-zinc-100 placeholder:text-zinc-500 outline-none text-sm"
          />
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {inputMode.active ? (
            <div className="px-4 py-6 text-center text-zinc-400 text-sm">
              Type your task and press Enter
            </div>
          ) : flatCommands.length === 0 ? (
            <div className="px-4 py-6 text-center text-zinc-500 text-sm">
              No commands found
            </div>
          ) : groups ? (
            // Grouped view (root level)
            groups.map((group) => {
              const startIndex = flatCommands.findIndex(
                (cmd) => cmd.id === group.commands[0]?.id
              );
              return (
                <CommandGroup
                  key={group.id}
                  group={group}
                  selectedIndex={selectedIndex}
                  startIndex={startIndex}
                  onSelectCommand={executeCommand}
                />
              );
            })
          ) : (
            // Flat view (subcommand level)
            <div className="py-2 space-y-0.5">
              {filteredCommands.map((command, index) => (
                <div key={command.id} data-selected={selectedIndex === index}>
                  <CommandItem
                    command={command}
                    isSelected={selectedIndex === index}
                    onSelect={() => executeCommand(command)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-zinc-800 text-xs text-zinc-500 flex items-center gap-4">
          <span>
            <kbd className="bg-zinc-800 px-1 rounded">↑</kbd>{' '}
            <kbd className="bg-zinc-800 px-1 rounded">↓</kbd> Navigate
          </span>
          <span>
            <kbd className="bg-zinc-800 px-1 rounded">Enter</kbd> Select
          </span>
          <span>
            <kbd className="bg-zinc-800 px-1 rounded">Esc</kbd> Close
          </span>
          {subcommandStack.length > 0 && (
            <span>
              <kbd className="bg-zinc-800 px-1 rounded">←</kbd> Back
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
