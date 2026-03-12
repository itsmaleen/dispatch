/**
 * Memory Types - Org-level and project-level memory system
 */

export type MemoryKind = 
  | 'decision'     // Key choices made
  | 'pattern'      // Preferred approaches
  | 'learning'     // What worked/didn't
  | 'context'      // Project-specific context
  | 'preference';  // User preferences

export interface MemoryEntry {
  /** Unique ID */
  id: string;
  
  /** Kind of memory */
  kind: MemoryKind;
  
  /** Short title */
  title: string;
  
  /** Full content */
  content: string;
  
  /** Source (task that generated this, user input, etc.) */
  source?: {
    type: 'task' | 'user' | 'agent' | 'import';
    taskId?: string;
    adapterId?: string;
  };
  
  /** Scoping */
  scope: {
    /** Global (org-level) or project-specific */
    level: 'org' | 'project';
    /** Project ID if project-scoped */
    projectId?: string;
  };
  
  /** Tags for search/filtering */
  tags?: string[];
  
  /** Relevance score (for search results) */
  relevance?: number;
  
  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
  
  /** Has this been confirmed by user? */
  confirmed: boolean;
}

export interface MemoryStore {
  /** All memory entries */
  entries: MemoryEntry[];
  
  /** Last sync time per adapter */
  syncState: Record<string, {
    adapterId: string;
    lastSyncAt: Date;
    lastSyncedEntryId?: string;
  }>;
}

/**
 * Memory sync format for different adapters
 */
export type AdapterMemoryFormat = 
  | 'claude-md'     // CLAUDE.md format
  | 'memory-md'     // OpenClaw MEMORY.md format
  | 'cursorrules'   // .cursorrules format
  | 'raw';          // Plain text injection

export interface MemorySyncConfig {
  /** Adapter ID */
  adapterId: string;
  
  /** Format to use for this adapter */
  format: AdapterMemoryFormat;
  
  /** Path to write sync file (if applicable) */
  syncPath?: string;
  
  /** Which memory kinds to include */
  includeKinds?: MemoryKind[];
  
  /** Whether to auto-sync on changes */
  autoSync: boolean;
}

/**
 * Request to extract learnings from a completed task
 */
export interface LearningExtractionRequest {
  taskId: string;
  adapterId: string;
  taskSummary: string;
  response: string;
  /** What to ask the extraction prompt */
  extractionPrompt?: string;
}

/**
 * Suggested memory entries from learning extraction
 */
export interface LearningExtractionResult {
  taskId: string;
  suggestions: Array<{
    kind: MemoryKind;
    title: string;
    content: string;
    confidence: number; // 0-1
  }>;
}

/**
 * Format memory for injection into agent prompt
 */
export function formatMemoryForPrompt(
  entries: MemoryEntry[],
  format: AdapterMemoryFormat
): string {
  if (entries.length === 0) return '';
  
  switch (format) {
    case 'claude-md':
      return formatAsClaudeMd(entries);
    case 'memory-md':
      return formatAsMemoryMd(entries);
    case 'cursorrules':
      return formatAsCursorrules(entries);
    case 'raw':
    default:
      return formatAsRaw(entries);
  }
}

function formatAsClaudeMd(entries: MemoryEntry[]): string {
  let content = '# Project Context\n\n';
  
  const grouped = groupByKind(entries);
  
  if (grouped.decision?.length) {
    content += '## Key Decisions\n\n';
    for (const entry of grouped.decision) {
      content += `- **${entry.title}**: ${entry.content}\n`;
    }
    content += '\n';
  }
  
  if (grouped.pattern?.length) {
    content += '## Preferred Patterns\n\n';
    for (const entry of grouped.pattern) {
      content += `- ${entry.content}\n`;
    }
    content += '\n';
  }
  
  if (grouped.learning?.length) {
    content += '## Learnings\n\n';
    for (const entry of grouped.learning) {
      content += `- ${entry.content}\n`;
    }
    content += '\n';
  }
  
  return content;
}

function formatAsMemoryMd(entries: MemoryEntry[]): string {
  let content = '# Memory Context\n\n';
  
  for (const entry of entries) {
    content += `## ${entry.title}\n`;
    content += `*${entry.kind} | ${entry.createdAt.toISOString().split('T')[0]}*\n\n`;
    content += `${entry.content}\n\n`;
  }
  
  return content;
}

function formatAsCursorrules(entries: MemoryEntry[]): string {
  let content = '# Agent Context (Auto-generated)\n\n';
  
  for (const entry of entries) {
    content += `## ${entry.kind.toUpperCase()}: ${entry.title}\n`;
    content += `${entry.content}\n\n`;
  }
  
  return content;
}

function formatAsRaw(entries: MemoryEntry[]): string {
  return entries
    .map(e => `[${e.kind}] ${e.title}: ${e.content}`)
    .join('\n\n');
}

function groupByKind(entries: MemoryEntry[]): Record<string, MemoryEntry[]> {
  return entries.reduce((acc, entry) => {
    const kind = entry.kind;
    if (!acc[kind]) acc[kind] = [];
    acc[kind].push(entry);
    return acc;
  }, {} as Record<string, MemoryEntry[]>);
}
