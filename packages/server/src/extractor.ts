/**
 * Task Extractor
 *
 * Uses the @anthropic-ai/claude-agent-sdk to extract tasks from assistant messages.
 * Keeps a persistent query session for fast extraction.
 */

import { query, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export interface ExtractedTask {
  /** Task text/description */
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
          text: { type: 'string' as const },
          status: {
            type: 'string' as const,
            enum: ['doing', 'planned', 'completed', 'suggested'] as const,
          },
          confidence: { type: 'number' as const },
        },
        required: ['text', 'status', 'confidence'] as const,
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

EXTRACT (real tasks):
- "Fixed the login bug in auth.ts" → completed
- "Implementing the new API endpoint" → doing
- "Next I'll add error handling" → planned
- "You might want to add rate limiting" → suggested

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

Respond with ONLY a single JSON object, no markdown and no explanation: {"tasks": [{"text": "...", "status": "doing|planned|completed|suggested", "confidence": 0.0-1.0}]}.`;

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
      .map((t) => ({
        text: String(t.text).trim(),
        status: ['doing', 'planned', 'completed', 'suggested'].includes(String(t.status))
          ? (t.status as ExtractedTask['status'])
          : 'suggested',
        confidence:
          typeof t.confidence === 'number'
            ? Math.max(0, Math.min(1, t.confidence))
            : 0.5,
      }));

    const byConfidence = mapped.filter((t) => t.confidence >= MIN_CONFIDENCE);
    const droppedConfidence = mapped.filter((t) => t.confidence < MIN_CONFIDENCE);
    if (droppedConfidence.length > 0) {
      console.log('[Extractor] Dropped (confidence < ', MIN_CONFIDENCE, '):', droppedConfidence.map((t) => ({ text: t.text.slice(0, 50), confidence: t.confidence })));
    }

    const tasks = byConfidence.filter((t) => !looksLikeMetaOrSummary(t.text));
    const droppedMeta = byConfidence.filter((t) => looksLikeMetaOrSummary(t.text));
    if (droppedMeta.length > 0) {
      console.log('[Extractor] Dropped (meta/summary):', droppedMeta.map((t) => ({ text: t.text.slice(0, 50) })));
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
