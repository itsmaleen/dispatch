/**
 * Thread Namer Service
 *
 * Uses Haiku to generate intelligent thread names and detect topic evolution.
 */

import { query, type Query } from '@anthropic-ai/claude-agent-sdk';

// ============================================================================
// Types
// ============================================================================

export interface EvolutionResult {
  /** Whether the topic has evolved enough to warrant action */
  shouldEvolve: boolean;
  /** Type of evolution detected */
  evolutionType: 'continuation' | 'evolution' | 'new_topic';
  /** Suggested new name if evolution detected */
  suggestedName?: string;
  /** Confidence in the assessment (0-1) */
  confidence: number;
}

export interface TopicSignature {
  /** Key concepts/topics extracted from conversation */
  concepts: string[];
  /** Primary domain/area */
  domain?: string;
  /** Last updated */
  updatedAt: Date;
}

// ============================================================================
// Prompts
// ============================================================================

const NAME_GENERATION_PROMPT = `Generate a concise thread name for this user request.

Rules:
- 3-8 words maximum
- Start with an action verb (Implement, Add, Fix, Update, Create, Build, Debug, Refactor, etc.)
- Be specific enough to distinguish from other work
- Never exceed 50 characters
- No quotes, no punctuation at end
- Imperative voice (like a task title)

Examples:
- "Add user authentication"
- "Fix login redirect bug"
- "Implement dark mode toggle"
- "Refactor database queries"
- "Debug payment webhook"

Return ONLY the thread name, nothing else.`;

const EVOLUTION_DETECTION_PROMPT = `Analyze if the new prompt represents a topic change from the current thread.

Current thread name: "{threadName}"
Recent conversation context: "{context}"

New prompt: "{newPrompt}"

Classify as one of:
1. "continuation" - Same topic, continuing the work
2. "evolution" - Related topic, thread name should update to reflect expanded scope
3. "new_topic" - Completely different topic, should be a new thread

Return JSON:
{
  "evolutionType": "continuation" | "evolution" | "new_topic",
  "confidence": 0.0-1.0,
  "suggestedName": "New name if evolution or new_topic, otherwise null",
  "reasoning": "Brief explanation"
}`;

const TOPIC_SIGNATURE_PROMPT = `Extract key concepts from this conversation prompt for semantic tracking.

Prompt: "{prompt}"

Return JSON:
{
  "concepts": ["concept1", "concept2", ...],  // 3-5 key technical concepts
  "domain": "area of work"  // e.g., "authentication", "database", "UI", "testing"
}`;

// ============================================================================
// Schema for structured output
// ============================================================================

const NAME_SCHEMA = {
  type: 'object' as const,
  properties: {
    name: {
      type: 'string' as const,
      description: 'The generated thread name, 3-8 words',
    },
  },
  required: ['name'] as const,
  additionalProperties: false,
};

const EVOLUTION_SCHEMA = {
  type: 'object' as const,
  properties: {
    evolutionType: {
      type: 'string' as const,
      enum: ['continuation', 'evolution', 'new_topic'] as const,
    },
    confidence: {
      type: 'number' as const,
    },
    suggestedName: {
      type: 'string' as const,
      nullable: true,
    },
    reasoning: {
      type: 'string' as const,
    },
  },
  required: ['evolutionType', 'confidence'] as const,
  additionalProperties: false,
};

const TOPIC_SCHEMA = {
  type: 'object' as const,
  properties: {
    concepts: {
      type: 'array' as const,
      items: { type: 'string' as const },
    },
    domain: {
      type: 'string' as const,
    },
  },
  required: ['concepts'] as const,
  additionalProperties: false,
};

// ============================================================================
// ThreadNamer Class
// ============================================================================

export class ThreadNamer {
  private activeQuery: Query | null = null;

  /**
   * Generate a thread name from the first prompt
   */
  async generateName(firstPrompt: string, timeoutMs = 5000): Promise<string> {
    // For very short prompts, use heuristics
    const trimmed = firstPrompt.trim();
    if (trimmed.length <= 30) {
      return this.heuristicName(trimmed);
    }

    // Truncate very long prompts
    const truncated = trimmed.length > 500 ? trimmed.slice(0, 500) + '...' : trimmed;

    try {
      const nameQuery = query({
        prompt: `${NAME_GENERATION_PROMPT}\n\nUser request:\n${truncated}`,
        options: {
          model: 'haiku',
          permissionMode: 'bypassPermissions',
          maxTurns: 1,
          effort: 'low',
          outputFormat: {
            type: 'json_schema',
            schema: NAME_SCHEMA,
          },
        },
      });

      this.activeQuery = nameQuery;

      // Set up timeout
      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), timeoutMs);
      });

      // Race between query and timeout
      let name: string | null = null;

      const queryPromise = (async () => {
        for await (const event of nameQuery) {
          if (event.type === 'result' && event.structured_output) {
            const output = event.structured_output as { name?: string };
            if (output.name) {
              name = this.cleanName(output.name);
            }
          }
        }
        return name;
      })();

      const result = await Promise.race([queryPromise, timeoutPromise]);

      if (result) {
        return result;
      }

      // Fallback to heuristic
      return this.heuristicName(trimmed);
    } catch (error) {
      console.error('[ThreadNamer] Name generation failed:', error);
      return this.heuristicName(trimmed);
    } finally {
      this.activeQuery = null;
    }
  }

  /**
   * Check if a new prompt represents topic evolution
   */
  async shouldEvolve(
    currentThreadName: string,
    recentContext: string,
    newPrompt: string,
    timeoutMs = 5000
  ): Promise<EvolutionResult> {
    const defaultResult: EvolutionResult = {
      shouldEvolve: false,
      evolutionType: 'continuation',
      confidence: 0.5,
    };

    // Skip check for very short prompts
    if (newPrompt.trim().length < 20) {
      return defaultResult;
    }

    try {
      const prompt = EVOLUTION_DETECTION_PROMPT
        .replace('{threadName}', currentThreadName)
        .replace('{context}', recentContext.slice(0, 500))
        .replace('{newPrompt}', newPrompt.slice(0, 500));

      const evolutionQuery = query({
        prompt,
        options: {
          model: 'haiku',
          permissionMode: 'bypassPermissions',
          maxTurns: 1,
          effort: 'low',
          outputFormat: {
            type: 'json_schema',
            schema: EVOLUTION_SCHEMA,
          },
        },
      });

      this.activeQuery = evolutionQuery;

      // Set up timeout
      const timeoutPromise = new Promise<EvolutionResult>((resolve) => {
        setTimeout(() => resolve(defaultResult), timeoutMs);
      });

      const queryPromise = (async () => {
        for await (const event of evolutionQuery) {
          if (event.type === 'result' && event.structured_output) {
            const output = event.structured_output as {
              evolutionType?: 'continuation' | 'evolution' | 'new_topic';
              confidence?: number;
              suggestedName?: string | null;
            };

            return {
              shouldEvolve: output.evolutionType !== 'continuation',
              evolutionType: output.evolutionType || 'continuation',
              suggestedName: output.suggestedName
                ? this.cleanName(output.suggestedName)
                : undefined,
              confidence: output.confidence ?? 0.5,
            };
          }
        }
        return defaultResult;
      })();

      return await Promise.race([queryPromise, timeoutPromise]);
    } catch (error) {
      console.error('[ThreadNamer] Evolution check failed:', error);
      return defaultResult;
    } finally {
      this.activeQuery = null;
    }
  }

  /**
   * Extract topic signature from a prompt for semantic tracking
   */
  async extractTopicSignature(
    prompt: string,
    timeoutMs = 3000
  ): Promise<TopicSignature> {
    const defaultSignature: TopicSignature = {
      concepts: [],
      updatedAt: new Date(),
    };

    try {
      const sigQuery = query({
        prompt: TOPIC_SIGNATURE_PROMPT.replace('{prompt}', prompt.slice(0, 500)),
        options: {
          model: 'haiku',
          permissionMode: 'bypassPermissions',
          maxTurns: 1,
          effort: 'low',
          outputFormat: {
            type: 'json_schema',
            schema: TOPIC_SCHEMA,
          },
        },
      });

      const timeoutPromise = new Promise<TopicSignature>((resolve) => {
        setTimeout(() => resolve(defaultSignature), timeoutMs);
      });

      const queryPromise = (async () => {
        for await (const event of sigQuery) {
          if (event.type === 'result' && event.structured_output) {
            const output = event.structured_output as {
              concepts?: string[];
              domain?: string;
            };

            return {
              concepts: output.concepts || [],
              domain: output.domain,
              updatedAt: new Date(),
            };
          }
        }
        return defaultSignature;
      })();

      return await Promise.race([queryPromise, timeoutPromise]);
    } catch (error) {
      console.error('[ThreadNamer] Topic signature extraction failed:', error);
      return defaultSignature;
    }
  }

  /**
   * Cancel any active query
   */
  cancel(): void {
    if (this.activeQuery) {
      this.activeQuery.cancel();
      this.activeQuery = null;
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Heuristic name generation for short prompts
   */
  private heuristicName(prompt: string): string {
    // Remove common prefixes
    let cleaned = prompt
      .replace(/^(please|can you|could you|help me|i need to|i want to)\s+/i, '')
      .replace(/^(the|a|an)\s+/i, '')
      .trim();

    // Capitalize first letter
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    // Truncate to reasonable length
    if (cleaned.length > 50) {
      cleaned = cleaned.slice(0, 47) + '...';
    }

    return cleaned || 'New thread';
  }

  /**
   * Clean and validate generated name
   */
  private cleanName(name: string): string {
    let cleaned = name
      .trim()
      // Remove quotes
      .replace(/^["']|["']$/g, '')
      // Remove trailing punctuation
      .replace(/[.!?]+$/, '')
      // Remove "Thread:" or similar prefixes
      .replace(/^(thread|task|topic|name):\s*/i, '')
      .trim();

    // Capitalize first letter
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    // Truncate to max length
    if (cleaned.length > 50) {
      cleaned = cleaned.slice(0, 47) + '...';
    }

    return cleaned || 'New thread';
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _threadNamer: ThreadNamer | null = null;

export function getThreadNamer(): ThreadNamer {
  if (!_threadNamer) {
    _threadNamer = new ThreadNamer();
  }
  return _threadNamer;
}
