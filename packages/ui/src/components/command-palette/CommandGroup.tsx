import { CommandItem } from './CommandItem';
import type { Command, CommandGroup as CommandGroupType } from '../../lib/commands/types';

interface CommandGroupProps {
  group: CommandGroupType;
  selectedIndex: number;
  startIndex: number;
  onSelectCommand: (command: Command) => void;
  /** Set of command IDs that were matched via semantic search */
  semanticMatchIds?: Set<string>;
}

export function CommandGroup({
  group,
  selectedIndex,
  startIndex,
  onSelectCommand,
  semanticMatchIds,
}: CommandGroupProps) {
  return (
    <div className="py-2">
      {/* Category header */}
      <div className="px-3 py-1.5 text-xs font-medium text-zinc-500 uppercase tracking-wider">
        {group.label}
      </div>

      {/* Commands */}
      <div className="space-y-0.5">
        {group.commands.map((command, index) => (
          <CommandItem
            key={command.id}
            command={command}
            isSelected={selectedIndex === startIndex + index}
            onSelect={() => onSelectCommand(command)}
            isSemanticMatch={semanticMatchIds?.has(command.id)}
          />
        ))}
      </div>
    </div>
  );
}
