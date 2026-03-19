import type { Command, CommandGroup, CommandCategory, ScoredCommand } from './types';

/**
 * Fuzzy match: check if all query characters appear in target in order
 */
function fuzzyMatch(query: string, target: string): boolean {
  let queryIndex = 0;
  for (let i = 0; i < target.length && queryIndex < query.length; i++) {
    if (target[i] === query[queryIndex]) {
      queryIndex++;
    }
  }
  return queryIndex === query.length;
}

/**
 * Score a command against a search query
 * Higher score = better match
 */
function scoreMatch(query: string, command: Command): number {
  if (!query) return 0;

  const queryLower = query.toLowerCase();
  const targets = [
    command.label,
    command.description || '',
    ...(command.keywords || []),
  ].map((s) => s.toLowerCase());

  let bestScore = 0;

  for (const target of targets) {
    // Exact match: 100
    if (target === queryLower) {
      bestScore = Math.max(bestScore, 100);
    }
    // Prefix match: 80
    else if (target.startsWith(queryLower)) {
      bestScore = Math.max(bestScore, 80);
    }
    // Word boundary match: 60
    else if (
      target.includes(' ' + queryLower) ||
      target.includes('-' + queryLower)
    ) {
      bestScore = Math.max(bestScore, 60);
    }
    // Substring match: 40
    else if (target.includes(queryLower)) {
      bestScore = Math.max(bestScore, 40);
    }
    // Fuzzy match: 20 (all query chars in order)
    else if (fuzzyMatch(queryLower, target)) {
      bestScore = Math.max(bestScore, 20);
    }
  }

  return bestScore;
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  navigation: 'Navigation',
  console: 'Agent Console',
  adapter: 'Adapters',
  task: 'Tasks',
  layout: 'Layout',
  terminal: 'Terminal',
};

const CATEGORY_ORDER: CommandCategory[] = [
  'console',
  'terminal',
  'layout',
  'task',
  'navigation',
  'adapter',
];

class CommandRegistry {
  private commands: Map<string, Command> = new Map();

  /**
   * Register a command
   */
  register(command: Command): void {
    this.commands.set(command.id, command);
  }

  /**
   * Register multiple commands
   */
  registerAll(commands: Command[]): void {
    for (const command of commands) {
      this.register(command);
    }
  }

  /**
   * Unregister a command
   */
  unregister(commandId: string): void {
    this.commands.delete(commandId);
  }

  /**
   * Clear all commands
   */
  clear(): void {
    this.commands.clear();
  }

  /**
   * Get all registered commands (optionally filtered by visibility)
   */
  getAll(filterByVisibility = true): Command[] {
    const commands = Array.from(this.commands.values());
    if (filterByVisibility) {
      return commands.filter(cmd => !cmd.isVisible || cmd.isVisible());
    }
    return commands;
  }

  /**
   * Get a command by ID
   */
  getById(id: string): Command | undefined {
    return this.commands.get(id);
  }

  /**
   * Search commands with fuzzy matching
   * Returns commands sorted by match score (best first)
   * Commands with isVisible() returning false are filtered out
   */
  search(query: string): Command[] {
    // Get all visible commands
    const commands = this.getAll(true);

    if (!query.trim()) {
      // No query - return all commands in category order
      return commands.sort((a, b) => {
        const aOrder = CATEGORY_ORDER.indexOf(a.category);
        const bOrder = CATEGORY_ORDER.indexOf(b.category);
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.label.localeCompare(b.label);
      });
    }

    // Score and filter commands
    const scored = commands
      .map((command) => ({
        command,
        score: scoreMatch(query, command),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map(({ command }) => command);
  }

  /**
   * Get commands grouped by category
   */
  getGroups(commands?: Command[]): CommandGroup[] {
    const cmds = commands ?? this.getAll();
    const groups: Map<CommandCategory, Command[]> = new Map();

    for (const command of cmds) {
      const existing = groups.get(command.category) || [];
      groups.set(command.category, [...existing, command]);
    }

    return CATEGORY_ORDER.filter((category) => groups.has(category)).map(
      (category) => ({
        id: category,
        label: CATEGORY_LABELS[category],
        commands: groups.get(category) || [],
      })
    );
  }
}

// Singleton instance
export const commandRegistry = new CommandRegistry();

/** Semantic search result from the server */
export interface SemanticSearchResult {
  commandId: string;
  score: number;
}

/**
 * Merge fuzzy search results with semantic search results
 *
 * - Deduplicates by command ID
 * - Boosts commands that appear in both fuzzy + semantic
 * - Orders by combined score (fuzzy score or 90% of semantic score, whichever is higher)
 * - Marks commands that were matched semantically
 */
export function mergeWithSemanticResults(
  fuzzyCommands: Command[],
  semanticResults: SemanticSearchResult[],
  query: string
): ScoredCommand[] {
  const semanticMap = new Map(semanticResults.map(r => [r.commandId, r.score]));
  const seen = new Set<string>();
  const enhanced: ScoredCommand[] = [];

  // Process fuzzy results first (they maintain category order)
  for (const cmd of fuzzyCommands) {
    if (seen.has(cmd.id)) continue;
    seen.add(cmd.id);

    const fuzzyScore = scoreMatch(query, cmd);
    const semanticScore = semanticMap.get(cmd.id);

    enhanced.push({
      ...cmd,
      fuzzyScore,
      semanticScore,
      isSemanticMatch: semanticScore !== undefined,
    });
  }

  // Add semantic-only results (not in fuzzy results)
  for (const { commandId, score } of semanticResults) {
    if (seen.has(commandId)) continue;

    const cmd = commandRegistry.getById(commandId);
    if (!cmd) continue;

    // Check visibility
    if (cmd.isVisible && !cmd.isVisible()) continue;

    seen.add(commandId);
    enhanced.push({
      ...cmd,
      fuzzyScore: 0,
      semanticScore: score,
      isSemanticMatch: true,
    });
  }

  // Sort by combined score
  // Fuzzy score takes priority, but semantic-only results get 90% weight
  return enhanced.sort((a, b) => {
    const scoreA = Math.max(a.fuzzyScore, (a.semanticScore || 0) * 0.9);
    const scoreB = Math.max(b.fuzzyScore, (b.semanticScore || 0) * 0.9);
    return scoreB - scoreA;
  });
}
