import { ChevronRight, Sparkles } from 'lucide-react';
import type { Command } from '../../lib/commands/types';

interface CommandItemProps {
  command: Command;
  isSelected: boolean;
  onSelect: () => void;
  /** Whether this command was matched via semantic search */
  isSemanticMatch?: boolean;
}

export function CommandItem({ command, isSelected, onSelect, isSemanticMatch }: CommandItemProps) {
  const Icon = command.icon;
  const hasSubcommand = command.action.type === 'subcommand';
  const hasInput = command.action.type === 'input';

  return (
    <button
      data-selected={isSelected}
      onClick={onSelect}
      className={`
        w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors
        ${isSelected
          ? 'bg-violet-600/20 border-l-2 border-violet-500 pl-[10px]'
          : 'hover:bg-zinc-800 border-l-2 border-transparent pl-[10px]'
        }
      `}
    >
      {/* Icon */}
      {Icon && (
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-zinc-400">
          <Icon className="w-4 h-4" />
        </div>
      )}

      {/* Label + Description */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-100 truncate flex items-center gap-2">
          {command.label}
          {/* AI Badge for semantic matches */}
          {isSemanticMatch && (
            <span className="inline-flex items-center gap-1 text-[10px] text-violet-400 bg-violet-500/20 px-1.5 py-0.5 rounded-full font-medium">
              <Sparkles className="w-2.5 h-2.5" />
              AI
            </span>
          )}
        </div>
        {command.description && (
          <div className="text-xs text-zinc-500 truncate">{command.description}</div>
        )}
      </div>

      {/* Shortcut badge or chevron */}
      <div className="flex-shrink-0 flex items-center gap-2">
        {command.shortcut && (
          <span className="bg-zinc-800 text-zinc-400 text-xs px-1.5 py-0.5 rounded font-mono">
            {command.shortcut}
          </span>
        )}
        {(hasSubcommand || hasInput) && (
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        )}
      </div>
    </button>
  );
}
