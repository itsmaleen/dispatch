import { ChevronRight } from 'lucide-react';
import type { Command } from '../../lib/commands/types';

interface CommandItemProps {
  command: Command;
  isSelected: boolean;
  onSelect: () => void;
}

export function CommandItem({ command, isSelected, onSelect }: CommandItemProps) {
  const Icon = command.icon;
  const hasSubcommand = command.action.type === 'subcommand';
  const hasInput = command.action.type === 'input';

  return (
    <button
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
        <div className="text-sm text-zinc-100 truncate">{command.label}</div>
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
