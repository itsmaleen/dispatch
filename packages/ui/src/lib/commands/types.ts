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

/** Command with search scoring metadata */
export interface ScoredCommand extends Command {
  /** Fuzzy search score (0-100) */
  fuzzyScore: number;
  /** Semantic search score (0-100), undefined if not matched semantically */
  semanticScore?: number;
  /** Whether this command was matched/boosted by semantic search */
  isSemanticMatch: boolean;
}

export interface CommandGroup {
  id: CommandCategory;
  label: string;
  commands: Command[];
}
