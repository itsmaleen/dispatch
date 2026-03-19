/**
 * Merge Message Generator Service
 *
 * Uses Haiku to generate intelligent merge commit messages by summarizing
 * the conversation context from the agent session.
 */

import { query, type Query } from '@anthropic-ai/claude-agent-sdk';

// ============================================================================
// Types
// ============================================================================

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface MergeMessageInput {
  /** The branch being merged */
  branch: string;
  /** The target branch being merged into */
  targetBranch: string;
  /** Conversation history from the session */
  messages: Message[];
  /** Thread name (often describes the task) */
  threadName?: string;
}

export interface MergeMessageResult {
  /** The generated commit message title (first line) */
  title: string;
  /** The full commit message with title and body */
  fullMessage: string;
}

// ============================================================================
// Prompts
// ============================================================================

const MERGE_MESSAGE_PROMPT = `You are summarizing work done by an AI coding agent into a git merge commit message.

Branch being merged: {branch}
Target branch: {targetBranch}
Thread/Task name: {threadName}

Here is the conversation between the user and the AI agent:

{conversation}

Based on this conversation, generate a git commit message that summarizes what was accomplished.

Rules for the commit message:
1. First line: Type prefix + concise summary (max 72 chars)
   - Use conventional commit types: feat, fix, refactor, docs, test, chore, style, perf
   - Be specific about what was added/changed/fixed
   - Focus on what the user asked for and what the agent delivered
2. Body: 2-4 bullet points describing the key changes
   - Focus on the "what" was accomplished, not the conversation
   - Group related changes together
   - Mention important implementation details

Format:
<type>(<scope>): <summary>

- <key accomplishment 1>
- <key accomplishment 2>
- <key accomplishment 3>

Example:
feat(auth): add JWT-based user authentication

- Implement login/logout endpoints with token generation
- Add middleware for protected routes
- Create user session management utilities

Return ONLY the commit message, nothing else.`;

// ============================================================================
// Schema for structured output
// ============================================================================

const MESSAGE_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: {
      type: 'string' as const,
      description: 'The commit message title (first line, max 72 chars)',
    },
    body: {
      type: 'string' as const,
      description: 'The commit message body with bullet points',
    },
  },
  required: ['title', 'body'] as const,
  additionalProperties: false,
};

// ============================================================================
// MergeMessageGenerator Class
// ============================================================================

export class MergeMessageGenerator {
  private activeQuery: Query | null = null;

  /**
   * Generate a merge commit message from conversation context
   */
  async generate(input: MergeMessageInput, timeoutMs = 10000): Promise<MergeMessageResult> {
    const defaultResult = this.createDefaultMessage(input);

    // If no messages, use default
    if (input.messages.length === 0) {
      return defaultResult;
    }

    try {
      // Format conversation for the prompt
      const conversation = this.formatConversation(input.messages);

      const prompt = MERGE_MESSAGE_PROMPT
        .replace('{branch}', input.branch)
        .replace('{targetBranch}', input.targetBranch)
        .replace('{threadName}', input.threadName || input.branch)
        .replace('{conversation}', conversation);

      const messageQuery = query({
        prompt,
        options: {
          model: 'haiku',
          permissionMode: 'bypassPermissions',
          maxTurns: 1,
          effort: 'low',
          outputFormat: {
            type: 'json_schema',
            schema: MESSAGE_SCHEMA,
          },
        },
      });

      this.activeQuery = messageQuery;

      // Set up timeout
      const timeoutPromise = new Promise<MergeMessageResult>((resolve) => {
        setTimeout(() => resolve(defaultResult), timeoutMs);
      });

      const queryPromise = (async () => {
        for await (const event of messageQuery) {
          // Check for structured output in result events
          const resultEvent = event as { type: string; structured_output?: { title?: string; body?: string } };
          if (resultEvent.type === 'result' && resultEvent.structured_output) {
            const output = resultEvent.structured_output;
            if (output.title) {
              const title = this.cleanTitle(output.title);
              const body = output.body || '';
              return {
                title,
                fullMessage: body ? `${title}\n\n${body}` : title,
              };
            }
          }
        }
        return defaultResult;
      })();

      return await Promise.race([queryPromise, timeoutPromise]);
    } catch (error) {
      console.error('[MergeMessageGenerator] Message generation failed:', error);
      return defaultResult;
    } finally {
      this.activeQuery = null;
    }
  }

  /**
   * Cancel any active query
   */
  cancel(): void {
    if (this.activeQuery) {
      // Cast to any since cancel may not be in type definitions
      (this.activeQuery as any).cancel?.();
      this.activeQuery = null;
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Format messages into a readable conversation string
   * Truncates to keep within token limits
   */
  private formatConversation(messages: Message[]): string {
    const formatted: string[] = [];
    let totalLength = 0;
    const maxLength = 15000; // Keep conversation context reasonable

    // Process messages in reverse order (most recent first) to prioritize recent context
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const roleLabel = msg.role === 'user' ? 'USER' : 'AGENT';
      // Truncate very long individual messages
      const content = msg.content.length > 3000
        ? msg.content.slice(0, 3000) + '... [truncated]'
        : msg.content;
      const line = `${roleLabel}: ${content}`;

      if (totalLength + line.length > maxLength) {
        break;
      }

      formatted.unshift(line); // Add to front to maintain order
      totalLength += line.length;
    }

    return formatted.join('\n\n');
  }

  /**
   * Create a default merge message when AI generation fails or is skipped
   */
  private createDefaultMessage(input: MergeMessageInput): MergeMessageResult {
    // Use thread name if available, otherwise branch name
    const title = input.threadName
      ? `Merge: ${input.threadName}`
      : `Merge branch '${input.branch}'`;

    return {
      title: title.length > 72 ? title.slice(0, 69) + '...' : title,
      fullMessage: title,
    };
  }

  /**
   * Clean and validate generated title
   */
  private cleanTitle(title: string): string {
    let cleaned = title
      .trim()
      // Remove quotes
      .replace(/^["']|["']$/g, '')
      // Remove trailing punctuation (except parens for scope)
      .replace(/[.!?]+$/, '')
      .trim();

    // Ensure it's not too long
    if (cleaned.length > 72) {
      cleaned = cleaned.slice(0, 69) + '...';
    }

    return cleaned || `Merge branch`;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _generator: MergeMessageGenerator | null = null;

export function getMergeMessageGenerator(): MergeMessageGenerator {
  if (!_generator) {
    _generator = new MergeMessageGenerator();
  }
  return _generator;
}
