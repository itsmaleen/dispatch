/**
 * Task Extractor
 *
 * Uses the @anthropic-ai/claude-agent-sdk to extract tasks from assistant messages.
 * Keeps a persistent query session for fast extraction.
 */

import { query, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export interface ExtractedTask {
  /** Concise 3-8 word summary in imperative voice */
  summary: string;
  /** Full task text/description */
  text: string;
  /** Status inferred from context */
  status: 'doing' | 'planned' | 'completed' | 'suggested';
  /** Confidence score 0-1 */
  confidence: number;
}

export interface ExtractionResult {
  tasks: ExtractedTask[];
}

/** Minimum confidence to keep a task; below this we treat as non-task (e.g. list items). */
const MIN_CONFIDENCE = 0.65;

/** JSON Schema for extraction result — used with SDK structured output so response is guaranteed valid. */
const EXTRACTION_SCHEMA = {
  type: 'object' as const,
  properties: {
    tasks: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          summary: {
            type: 'string' as const,
            description: 'Concise 3-8 word goal in imperative voice (e.g., "Add rate limiting to API")',
          },
          text: { type: 'string' as const },
          status: {
            type: 'string' as const,
            enum: ['doing', 'planned', 'completed', 'suggested'] as const,
          },
          confidence: { type: 'number' as const },
        },
        required: ['summary', 'text', 'status', 'confidence'] as const,
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'] as const,
  additionalProperties: false,
};

/** Prefixes that indicate meta/summary text — never treat as a task. */
const META_PREFIXES = [
  /^here'?s a summary of/i,
  /^here'?s what (changed|i did|we did)/i,
  /^summary of (changes?|the|latest)/i,
  /^in short:?/i,
  /^in summary:?/i,
  /^the following (changes?|updates?|items?)/i,
  /^here (is|are) the (changes?|updates?)/i,
  /^this (message|reply) (summarizes|describes|lists)/i,
];

function looksLikeMetaOrSummary(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 15) return false;
  return META_PREFIXES.some((re) => re.test(trimmed));
}

/** Parse assistant text as JSON for fallback when structured_output is missing. */
function parseTextAsJson(text: string): { tasks: unknown[] } | null {
  let jsonStr = text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  const start = jsonStr.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString: '"' | "'" | null = null;
  let i = start;
  while (i < jsonStr.length) {
    const c = jsonStr[i];
    if (inString) {
      if (c === inString && jsonStr[i - 1] !== '\\') inString = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const slice = jsonStr.slice(start, i + 1);
        try {
          const parsed = JSON.parse(slice) as unknown;
          if (parsed != null && typeof parsed === 'object' && 'tasks' in parsed && Array.isArray((parsed as { tasks: unknown }).tasks)) {
            return parsed as { tasks: unknown[] };
          }
        } catch {
          // ignore
        }
        return null;
      }
    }
    i++;
  }
  return null;
}

const EXTRACTOR_SYSTEM_PROMPT = `You are a task extractor for an AI coding assistant orchestrator.

Extract genuine work tasks from agent output. A task is something the agent DID, IS DOING, WILL DO, or something that should be done next (recommendations, blockers, priorities).

For each task, provide:
- summary: A concise 3-8 word goal statement in imperative voice
- text: The complete extracted context for reference

The summary should:
- Start with an action verb (Add, Fix, Update, Implement, Create, Remove, Refactor, etc.)
- Be specific enough to understand the task without the full text
- Never exceed 60 characters
- Never include meta-language like "Task:", "TODO:", etc.

Examples of good summaries:
- "Add rate limiting to API endpoints"
- "Fix authentication middleware bug"
- "Update user schema with new fields"
- "Implement dark mode toggle"
- "Remove deprecated API calls"

EXTRACT (real tasks):
- "Fixed the login bug in auth.ts" → summary: "Fix login bug in auth.ts", status: completed
- "Implementing the new API endpoint" → summary: "Implement new API endpoint", status: doing
- "Next I'll add error handling" → summary: "Add error handling", status: planned
- "You might want to add rate limiting" → summary: "Add rate limiting", status: suggested

Also EXTRACT when the message is a recommendation, "what to work on next", or "what's needed to ship": treat each blocker, priority item, or recommended step as a task (status: suggested or planned). Examples: "No tests at all" / "Add tests for parseTextAsJson" → suggested; "Clean up debug logging" → suggested; "Text hash normalization gap" → suggested; "Start with tests (item 1)" → planned; "Replace as any casts with SDK types" → suggested.

DO NOT EXTRACT (not tasks):
- Summary headers or opening paragraphs: "Here's what changed...", "Summary of changes...", "Here's a summary of the latest..."
- Meta-commentary: "Let me explain...", "I'll show you...", "In short:", "In summary"
- Observations: "The file contains...", "This code does..."
- Questions: "Should I proceed?", "Do you want me to..."
- Bare lists of file names or change summaries only (e.g. "Modified foo.ts, bar.ts"). Do NOT skip lists that are clearly recommended next steps, blockers, or priority work items — extract those.
- Introductory sentences before lists (e.g. the first paragraph that describes what follows). Still extract the list items that follow.
- Status updates: "Done!", "Finished!", "Complete!" (without saying WHAT was done)

Never extract only the opening sentence or paragraph when it is pure intro. If the message has a section like "Blockers", "High priority", "What's needed", or "Recommendations" with concrete items, extract each of those items as tasks.
Return empty tasks array ONLY when there are no actionable work items (no next steps, no blockers, no recommendations, no stated work the agent did/is doing/will do). If there is any list of things to do or address, extract those items.
For recommended-next-step items use confidence 0.7–0.9 so they are retained.

Respond with ONLY a single JSON object, no markdown and no explanation: {"tasks": [{"summary": "...", "text": "...", "status": "doing|planned|completed|suggested", "confidence": 0.0-1.0}]}.`;

export class TaskExtractor {
  private activeQuery: Query | null = null;
  private isReady = false;

  constructor() {}

  /** Extract tasks from assistant message content */
  async extract(assistantMessage: string, timeoutMs = 15000): Promise<ExtractionResult> {
    // Truncate very long outputs
    const maxChars = 8000;
    const truncated = assistantMessage.length > maxChars
      ? assistantMessage.slice(-maxChars) + '\n[...truncated]'
      : assistantMessage;

    const prompt = `Extract tasks from this assistant message:\n\n${truncated}`;

    console.log('[Extractor] extract() input length:', assistantMessage.length, 'truncated:', truncated.length);

    try {
      // Create query with schema-guaranteed structured output (no free-form JSON parsing)
      this.activeQuery = query({
        prompt,
        options: {
          systemPrompt: EXTRACTOR_SYSTEM_PROMPT,
          model: 'haiku',
          permissionMode: 'bypassPermissions',
          maxTurns: 1,
          effort: 'low',
          includePartialMessages: true,
          outputFormat: {
            type: 'json_schema',
            schema: EXTRACTION_SCHEMA,
          },
        },
      });

      let result: ExtractionResult = { tasks: [] };
      let outputBuffer = '';
      const eventTypes: string[] = [];

      for await (const event of this.activeQuery) {
        eventTypes.push(event.type);
        if (event.type === 'assistant') {
          const content = (event as { message?: { content?: Array<{ type?: string; text?: string }> } }).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block?.type === 'text' && typeof block.text === 'string') {
                outputBuffer += block.text;
              }
            }
          }
        } else if (event.type === 'stream_event') {
          const streamEvent = (event as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
          if (streamEvent?.type === 'content_block_delta' && streamEvent.delta?.type === 'text_delta' && streamEvent.delta.text) {
            outputBuffer += streamEvent.delta.text;
          }
        } else if (event.type === 'result') {
          const msg = event as {
            type: 'result';
            structured_output?: unknown;
            subtype?: string;
            result?: string;
            message?: string;
          };
          if (msg.subtype === 'success' && msg.structured_output != null) {
            const raw = msg.structured_output as { tasks?: Array<{ text?: string; status?: string; confidence?: number }> };
            if (Array.isArray(raw?.tasks)) {
              console.log('[Extractor] structured_output potential tasks:', raw.tasks.map((t) => ({
                text: (t?.text ?? '').slice(0, 80),
                status: t?.status,
                confidence: t?.confidence,
              })));
            }
            result = this.normalizeAndFilter(msg.structured_output);
            console.log('[Extractor] structured_output after filter:', result.tasks.length, 'tasks');
          }
          // When structured_output is missing, result event may still carry final text (SDK-dependent)
          if (result.tasks.length === 0 && typeof (msg.result ?? msg.message) === 'string') {
            const text = (msg.result ?? msg.message) as string;
            if (text.trim().length > 0) outputBuffer = outputBuffer ? outputBuffer + '\n' + text : text;
          }
        }
      }

      if (result.tasks.length === 0 && outputBuffer.trim().length > 0) {
        const parsed = parseTextAsJson(outputBuffer);
        if (parsed != null) {
          const rawTasks = (parsed.tasks as Array<{ text?: string; status?: string; confidence?: number }>).filter(
            (t) => t != null && typeof t === 'object' && typeof t?.text === 'string'
          );
          console.log('[Extractor] Potential tasks (before filter):', rawTasks.map((t) => ({
            text: (t.text ?? '').slice(0, 80),
            status: t.status,
            confidence: t.confidence,
          })));
          result = this.normalizeAndFilter(parsed);
          console.log('[Extractor] After filter:', result.tasks.length, 'tasks;', result.tasks.map((t) => ({ text: t.text.slice(0, 60), status: t.status, confidence: t.confidence })));
        } else {
          console.warn('[Extractor] Parse failed; buffer len=', outputBuffer.length, 'snippet:', JSON.stringify(outputBuffer.slice(0, 350)));
        }
        if (result.tasks.length === 0) {
          console.warn('[Extractor] No tasks: buffer len=', outputBuffer.length, 'parse ok=', parsed != null);
        }
      } else if (result.tasks.length === 0 && outputBuffer.trim().length === 0) {
        console.warn('[Extractor] No tasks: extraction query produced no response text (structured_output missing and buffer empty). Event types seen:', eventTypes.join(', '));
      }

      this.activeQuery = null;
      return result;

    } catch (error) {
      this.activeQuery = null;
      console.error('[Extractor] Extraction failed:', error);
      return { tasks: [] };
    }
  }

  /** Generate a fallback summary from task text if not provided */
  private generateFallbackSummary(text: string): string {
    // Take first sentence or first 60 chars
    const firstSentence = text.split(/[.!?\n]/)[0]?.trim() ?? text;
    if (firstSentence.length <= 60) {
      return firstSentence;
    }
    // Truncate at word boundary
    const truncated = firstSentence.slice(0, 57);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 30 ? truncated.slice(0, lastSpace) : truncated) + '...';
  }

  /** Normalize and filter structured_output from SDK; no string parsing. */
  private normalizeAndFilter(raw: unknown): ExtractionResult {
    if (raw == null || typeof raw !== 'object' || !('tasks' in raw)) {
      return { tasks: [] };
    }
    const { tasks: rawTasks } = raw as { tasks?: unknown };
    if (!Array.isArray(rawTasks)) {
      return { tasks: [] };
    }

    const mapped: ExtractedTask[] = rawTasks
      .filter((t: unknown): t is Record<string, unknown> => t != null && typeof t === 'object')
      .filter((t) => typeof t.text === 'string' && String(t.text).trim().length > 3)
      .map((t) => {
        const text = String(t.text).trim();
        // Use provided summary or generate fallback
        const summary = typeof t.summary === 'string' && t.summary.trim().length > 0
          ? t.summary.trim().slice(0, 60)
          : this.generateFallbackSummary(text);

        return {
          summary,
          text,
          status: ['doing', 'planned', 'completed', 'suggested'].includes(String(t.status))
            ? (t.status as ExtractedTask['status'])
            : 'suggested',
          confidence:
            typeof t.confidence === 'number'
              ? Math.max(0, Math.min(1, t.confidence))
              : 0.5,
        };
      });

    const byConfidence = mapped.filter((t) => t.confidence >= MIN_CONFIDENCE);
    const droppedConfidence = mapped.filter((t) => t.confidence < MIN_CONFIDENCE);
    if (droppedConfidence.length > 0) {
      console.log('[Extractor] Dropped (confidence < ', MIN_CONFIDENCE, '):', droppedConfidence.map((t) => ({ summary: t.summary, confidence: t.confidence })));
    }

    const tasks = byConfidence.filter((t) => !looksLikeMetaOrSummary(t.text));
    const droppedMeta = byConfidence.filter((t) => looksLikeMetaOrSummary(t.text));
    if (droppedMeta.length > 0) {
      console.log('[Extractor] Dropped (meta/summary):', droppedMeta.map((t) => ({ summary: t.summary })));
    }

    return { tasks };
  }

  /** Check if extractor has an active query */
  get busy(): boolean {
    return this.activeQuery !== null;
  }

  /** Interrupt active extraction */
  async interrupt(): Promise<void> {
    if (this.activeQuery) {
      try {
        await this.activeQuery.interrupt();
      } catch {
        // Ignore interrupt errors
      }
      this.activeQuery = null;
    }
  }

  /** For compatibility - always ready since no persistent subprocess */
  get ready(): boolean {
    return true;
  }
}

// Singleton instance
let _extractor: TaskExtractor | null = null;

export function getExtractor(): TaskExtractor {
  if (!_extractor) {
    _extractor = new TaskExtractor();
  }
  return _extractor;
}

/** Quick extract helper */
export async function extractTasks(assistantMessage: string): Promise<ExtractionResult> {
  return getExtractor().extract(assistantMessage);
}

// ============================================================================
// PROMPT SUMMARIZER - Creates concise task titles from user prompts
// ============================================================================

const SUMMARIZER_SYSTEM_PROMPT = `You are a prompt summarizer. Given a user prompt to an AI coding assistant, create a concise 3-8 word task title that captures the main intent.

Rules:
- Start with an action verb (Add, Fix, Update, Implement, Create, Remove, Refactor, Debug, Help, etc.)
- Be specific but concise (3-8 words max)
- Never exceed 50 characters
- Focus on WHAT the user wants to accomplish
- Ignore pleasantries, context, or explanations - just the core task
- If the prompt is a question, summarize what they're asking about

Examples:
- "Can you help me add a dark mode toggle to my React app? I want users to be able to switch between light and dark themes." → "Add dark mode toggle"
- "I'm getting an error when I try to login. The error says 'invalid credentials' but I'm using the correct password." → "Fix login authentication error"
- "Please refactor the user service to use dependency injection instead of creating instances directly" → "Refactor user service for DI"
- "What does this regex do? /^[a-zA-Z0-9]+$/" → "Explain alphanumeric regex"
- "run the tests" → "Run tests"
- "help me understand how the auth middleware works in this codebase" → "Explain auth middleware"

Respond with ONLY the task title, no quotes, no explanation.`;

const SUMMARIZER_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: {
      type: 'string' as const,
      description: 'Concise 3-8 word task title starting with an action verb',
    },
  },
  required: ['title'] as const,
  additionalProperties: false,
};

export class PromptSummarizer {
  /** Summarize a user prompt into a concise task title */
  async summarize(prompt: string, timeoutMs = 5000): Promise<string> {
    // For very short prompts, just clean them up
    const trimmed = prompt.trim();
    if (trimmed.length <= 40) {
      return this.cleanupShortPrompt(trimmed);
    }

    // Truncate very long prompts
    const maxChars = 2000;
    const truncated = trimmed.length > maxChars
      ? trimmed.slice(0, maxChars) + '\n[...truncated]'
      : trimmed;

    try {
      const summarizerQuery = query({
        prompt: `Summarize this user prompt into a task title:\n\n${truncated}`,
        options: {
          systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
          model: 'haiku',
          permissionMode: 'bypassPermissions',
          maxTurns: 1,
          effort: 'low',
          outputFormat: {
            type: 'json_schema',
            schema: SUMMARIZER_SCHEMA,
          },
        },
      });

      let title = '';

      for await (const event of summarizerQuery) {
        if (event.type === 'result') {
          const msg = event as {
            type: 'result';
            structured_output?: { title?: string };
            subtype?: string;
          };
          if (msg.subtype === 'success' && msg.structured_output?.title) {
            title = msg.structured_output.title.trim().slice(0, 50);
          }
        } else if (event.type === 'assistant') {
          // Fallback: try to extract from text
          const content = (event as { message?: { content?: Array<{ type?: string; text?: string }> } }).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block?.type === 'text' && typeof block.text === 'string' && !title) {
                // Try to parse as JSON or use raw text
                try {
                  const parsed = JSON.parse(block.text);
                  if (parsed.title) title = parsed.title.trim().slice(0, 50);
                } catch {
                  // Use raw text if it's short enough
                  const text = block.text.trim();
                  if (text.length > 0 && text.length <= 60) {
                    title = text.slice(0, 50);
                  }
                }
              }
            }
          }
        }
      }

      if (title) {
        console.log('[PromptSummarizer] Generated title:', title);
        return title;
      }

      // Fallback to heuristic
      return this.heuristicSummary(trimmed);
    } catch (error) {
      console.error('[PromptSummarizer] Summarization failed:', error);
      return this.heuristicSummary(trimmed);
    }
  }

  /** Quick cleanup for short prompts */
  private cleanupShortPrompt(prompt: string): string {
    // Remove common prefixes
    let cleaned = prompt
      .replace(/^(please|can you|could you|help me|i need to|i want to)\s+/i, '')
      .trim();

    // Capitalize first letter
    if (cleaned.length > 0) {
      cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
    }

    return cleaned || prompt;
  }

  /** Heuristic-based summary as fallback */
  private heuristicSummary(prompt: string): string {
    const trimmed = prompt.trim();

    // Try to extract first sentence
    const firstSentence = trimmed.split(/[.!?\n]/)[0]?.trim();
    if (firstSentence && firstSentence.length <= 50) {
      return this.cleanupShortPrompt(firstSentence);
    }

    // Look for command patterns
    const commandMatch = trimmed.match(/^(run|execute|help me|please|can you|i need to|let's|let me|add|fix|update|create|implement|debug)\s+(.{10,40})/i);
    if (commandMatch) {
      return commandMatch[0].slice(0, 50);
    }

    // Truncate at word boundary
    const truncated = trimmed.slice(0, 47);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '...';
  }
}

// Singleton instance
let _summarizer: PromptSummarizer | null = null;

export function getPromptSummarizer(): PromptSummarizer {
  if (!_summarizer) {
    _summarizer = new PromptSummarizer();
  }
  return _summarizer;
}

/** Quick summarize helper */
export async function summarizePrompt(prompt: string): Promise<string> {
  return getPromptSummarizer().summarize(prompt);
}
