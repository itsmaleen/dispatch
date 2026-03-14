/**
 * Task Extractor
 * 
 * Uses the @anthropic-ai/claude-agent-sdk to extract tasks from terminal output.
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

const EXTRACTOR_SYSTEM_PROMPT = `You are a task extractor for an AI coding assistant orchestrator.

Extract ONLY genuine work tasks from agent output. A task is something the agent DID, IS DOING, or WILL DO.

EXTRACT (real tasks):
- "Fixed the login bug in auth.ts" → completed
- "Implementing the new API endpoint" → doing  
- "Next I'll add error handling" → planned
- "You might want to add rate limiting" → suggested

DO NOT EXTRACT (not tasks):
- Summary headers: "Here's what changed...", "Summary of changes..."
- Meta-commentary: "Let me explain...", "I'll show you..."
- Observations: "The file contains...", "This code does..."
- Questions: "Should I proceed?", "Do you want me to..."
- Lists of files or changes (the list items themselves)
- Introductory sentences before lists
- Status updates: "Done!", "Finished!", "Complete!" (without saying WHAT was done)

Respond with ONLY valid JSON (no markdown):
{"tasks": [{"text": "...", "status": "doing|planned|completed|suggested", "confidence": 0.0-1.0}]}

Return empty tasks array [] if no genuine tasks found. Be conservative - when in doubt, don't extract.`;

export class TaskExtractor {
  private activeQuery: Query | null = null;
  private isReady = false;

  constructor() {}

  /** Extract tasks from terminal output */
  async extract(terminalOutput: string, timeoutMs = 15000): Promise<ExtractionResult> {
    // Truncate very long outputs
    const maxChars = 8000;
    const truncated = terminalOutput.length > maxChars 
      ? terminalOutput.slice(-maxChars) + '\n[...truncated]'
      : terminalOutput;

    const prompt = `Extract tasks from this terminal output:\n\n${truncated}`;

    try {
      // Create query with fast settings for extraction
      this.activeQuery = query({
        prompt,
        options: {
          systemPrompt: EXTRACTOR_SYSTEM_PROMPT,
          model: 'haiku',
          permissionMode: 'bypassPermissions',
          maxTurns: 1,
          effort: 'low',
        },
      });

      let outputBuffer = '';

      // Process the stream
      for await (const event of this.activeQuery) {
        if (event.type === 'assistant' && (event as any).message?.content) {
          for (const block of (event as any).message.content) {
            if (block.type === 'text' && block.text) {
              outputBuffer += block.text;
            }
          }
        }
      }

      this.activeQuery = null;

      // Parse the result
      return this.parseResult(outputBuffer);

    } catch (error) {
      this.activeQuery = null;
      console.error('[Extractor] Extraction failed:', error);
      return { tasks: [] };
    }
  }

  private parseResult(output: string): ExtractionResult {
    try {
      // Clean up the output - extract JSON from any surrounding text
      let jsonStr = output.trim();
      
      // Handle markdown code blocks
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      
      // Try to extract JSON object if wrapped in other text
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const result = JSON.parse(jsonStr);
      
      // Validate structure
      if (!result.tasks || !Array.isArray(result.tasks)) {
        return { tasks: [] };
      }

      // Normalize and validate each task
      const tasks: ExtractedTask[] = result.tasks
        .filter((t: any) => typeof t?.text === 'string' && t.text.trim().length > 3)
        .map((t: any) => ({
          text: t.text.trim(),
          status: ['doing', 'planned', 'completed', 'suggested'].includes(t.status) 
            ? t.status 
            : 'suggested',
          confidence: typeof t.confidence === 'number' 
            ? Math.max(0, Math.min(1, t.confidence))
            : 0.5,
        }));

      return { tasks };
      
    } catch (error) {
      console.error('[Extractor] Failed to parse result:', output);
      return { tasks: [] };
    }
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
export async function extractTasks(terminalOutput: string): Promise<ExtractionResult> {
  return getExtractor().extract(terminalOutput);
}
