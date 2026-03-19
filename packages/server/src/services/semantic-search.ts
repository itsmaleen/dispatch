/**
 * Semantic Search Service
 *
 * Uses Claude Code (via the Agent SDK) for semantic matching of commands.
 * Provides intelligent command search that understands user intent.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

export interface CommandInfo {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  category: string;
}

export interface SemanticSearchResult {
  commandId: string;
  score: number;  // 0-100, semantic relevance
}

export interface SemanticSearchResponse {
  results: SemanticSearchResult[];
  cached: boolean;
  latencyMs: number;
}

interface CacheEntry {
  results: SemanticSearchResult[];
  timestamp: number;
}

const SEMANTIC_SEARCH_PROMPT = `You are a command palette search assistant. Match the user's query to the most relevant commands.

AVAILABLE COMMANDS:
{{COMMANDS}}

USER QUERY: "{{QUERY}}"

Return ONLY a JSON array of the top 1-5 most semantically relevant commands:
[{"commandId": "...", "score": 0-100}]

Score guidelines:
- 100: Exact semantic match or clear intent
- 80: Strong conceptual match
- 60: Related functionality
- 40: Loose association
- Below 40: Don't include

Only include commands that genuinely match the user's intent.
Return [] if no good matches.
Return ONLY the JSON array, no explanation or markdown.`;

export class SemanticSearchService {
  private initialized = false;

  // LRU cache with TTL
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutes
  private readonly MAX_CACHE_SIZE = 100;

  // Command corpus (set once on init)
  private commandCorpus: string = '';
  private commandIds: Set<string> = new Set();

  // Track if a query is currently running to avoid concurrent queries
  private isQuerying = false;

  constructor() {
    // Check if claude CLI is available
    this.checkClaudeAvailability();
  }

  private async checkClaudeAvailability(): Promise<void> {
    try {
      const { execSync } = await import('child_process');
      execSync('which claude', { encoding: 'utf-8' });
      this.initialized = true;
      console.log('[SemanticSearch] Initialized with Claude Code CLI');
    } catch {
      console.log('[SemanticSearch] Claude Code CLI not found - semantic search disabled');
      this.initialized = false;
    }
  }

  /** Initialize with command definitions */
  setCommands(commands: CommandInfo[]): void {
    this.commandCorpus = commands.map(cmd =>
      `- ${cmd.id}: "${cmd.label}" (${cmd.category})${cmd.description ? ` - ${cmd.description}` : ''}${cmd.keywords?.length ? ` [${cmd.keywords.join(', ')}]` : ''}`
    ).join('\n');

    this.commandIds = new Set(commands.map(cmd => cmd.id));

    // Clear cache when commands change
    this.cache.clear();

    console.log(`[SemanticSearch] Loaded ${commands.length} commands`);
  }

  /** Check if service is ready */
  isReady(): boolean {
    return this.initialized && this.commandCorpus.length > 0;
  }

  /** Search commands semantically */
  async search(userQuery: string): Promise<SemanticSearchResponse> {
    const startTime = Date.now();

    // Check cache first
    const cacheKey = userQuery.toLowerCase().trim();
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS) {
      return {
        results: cached.results,
        cached: true,
        latencyMs: Date.now() - startTime,
      };
    }

    // Early return if not ready
    if (!this.initialized || !userQuery.trim()) {
      return { results: [], cached: false, latencyMs: 0 };
    }

    if (!this.commandCorpus) {
      console.warn('[SemanticSearch] No commands loaded - call setCommands() first');
      return { results: [], cached: false, latencyMs: 0 };
    }

    // Avoid concurrent queries
    if (this.isQuerying) {
      console.log('[SemanticSearch] Query already in progress, skipping');
      return { results: [], cached: false, latencyMs: 0 };
    }

    this.isQuerying = true;

    try {
      const prompt = SEMANTIC_SEARCH_PROMPT
        .replace('{{COMMANDS}}', this.commandCorpus)
        .replace('{{QUERY}}', userQuery);

      // Use Claude Code SDK with minimal settings for fast response
      const queryInstance = query({
        prompt,
        options: {
          maxTurns: 1,  // Single response, no agentic loops
          permissionMode: 'bypassPermissions',
          model: 'haiku',  // Use haiku for speed
        },
      });

      let responseText = '';

      // Collect the response
      for await (const event of queryInstance) {
        if (event.type === 'assistant') {
          const content = (event.message as any)?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block?.type === 'text' && typeof block.text === 'string') {
                responseText += block.text;
              }
            }
          }
        } else if (event.type === 'result') {
          // Query complete
          break;
        }
      }

      const results = this.parseResponse(responseText);

      // Update cache
      this.updateCache(cacheKey, results);

      return {
        results,
        cached: false,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      console.error('[SemanticSearch] Failed:', error);
      return { results: [], cached: false, latencyMs: Date.now() - startTime };
    } finally {
      this.isQuerying = false;
    }
  }

  private parseResponse(text: string): SemanticSearchResult[] {
    try {
      let jsonStr = text.trim();

      // Handle markdown code blocks
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      // Try to find JSON array in the response
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        jsonStr = arrayMatch[0];
      }

      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(item =>
          item.commandId &&
          typeof item.score === 'number' &&
          this.commandIds.has(item.commandId)  // Validate command exists
        )
        .map(item => ({
          commandId: item.commandId,
          score: Math.min(100, Math.max(0, item.score)),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);  // Top 5 results
    } catch {
      console.error('[SemanticSearch] Failed to parse response:', text);
      return [];
    }
  }

  private updateCache(key: string, results: SemanticSearchResult[]): void {
    // Evict oldest entry if cache is full (LRU)
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const oldest = [...this.cache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    this.cache.set(key, { results, timestamp: Date.now() });
  }

  /** Clear the cache */
  clearCache(): void {
    this.cache.clear();
  }

  /** Get cache stats for debugging */
  getCacheStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: this.MAX_CACHE_SIZE,
      ttlMs: this.CACHE_TTL_MS,
    };
  }

  /** Get diagnostic info for debugging */
  getDiagnostics(): {
    hasClaudeCLI: boolean;
    initialized: boolean;
    commandCount: number;
    isReady: boolean;
    isQuerying: boolean;
  } {
    return {
      hasClaudeCLI: this.initialized,
      initialized: this.initialized,
      commandCount: this.commandIds.size,
      isReady: this.isReady(),
      isQuerying: this.isQuerying,
    };
  }
}

// Singleton
let _service: SemanticSearchService | null = null;

export function getSemanticSearchService(): SemanticSearchService {
  if (!_service) {
    _service = new SemanticSearchService();
  }
  return _service;
}
