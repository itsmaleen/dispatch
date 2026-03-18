import type { ComponentType } from 'react';

export type CommandCategory = 'navigation' | 'console' | 'adapter' | 'task' | 'layout' | 'terminal';

export type CommandAction =
  | { type: 'execute'; handler: () => void | Promise<void> }
  | { type: 'subcommand'; getCommands: () => Command[] }
  | { type: 'input'; placeholder: string; onSubmit: (value: string) => void };

export interface Command {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  icon?: ComponentType<{ className?: string }>;
  shortcut?: string; // Display string like "⌘N"
  keywords?: string[]; // Additional search terms
  action: CommandAction;
  /** Optional function to determine if this command should be visible. If not provided, command is always visible. */
  isVisible?: () => boolean;
}

export interface CommandGroup {
  id: CommandCategory;
  label: string;
  commands: Command[];
}
