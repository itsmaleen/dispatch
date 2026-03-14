/**
 * Task Classifier Service
 * 
 * Uses a fast LLM (Haiku) to semantically extract tasks from agent output.
 * Distinguishes between active work, planned tasks, suggestions, and completions.
 */

import Anthropic from '@anthropic-ai/sdk';

export interface ExtractedTask {
  text: string;
  category: 'doing' | 'planned' | 'suggested' | 'completed';
  confidence: number;  // 0-1
}

export interface ClassificationResult {
  doing: ExtractedTask[];
  planned: ExtractedTask[];
  suggested: ExtractedTask[];
  completed: ExtractedTask[];
  raw?: string;  // For debugging
}

const CLASSIFIER_PROMPT = `You are a task extraction system. Analyze the agent output and extract ONLY actionable tasks.

EXTRACT these categories:
- "doing": Tasks the agent is ACTIVELY working on NOW
  Examples: "Reading file...", "Running npm install", "Analyzing the code"
  
- "planned": Tasks the agent WILL do next (committed, not optional)
  Examples: "I'll then update the config", "Next I will add tests", "After that, I'll refactor"
  
- "completed": Tasks the agent just FINISHED in this message
  Examples: "Created src/utils.ts", "Updated the API endpoint", "Fixed the bug in..."
  
- "suggested": Tasks the agent RECOMMENDS but isn't doing
  Examples: "You might want to add...", "Consider implementing...", "It would be good to..."

DO NOT extract:
- Explanations or descriptions ("This file contains...")
- Lists of options or alternatives ("You could do A, B, or C")
- Code content or file contents
- General information or context
- Questions ("Should I proceed?")

For each task, provide confidence (0.0-1.0) based on how clearly it's a task.

Respond with ONLY valid JSON:
{
  "doing": [{"text": "...", "confidence": 0.9}],
  "planned": [{"text": "...", "confidence": 0.85}],
  "completed": [{"text": "...", "confidence": 0.95}],
  "suggested": [{"text": "...", "confidence": 0.7}]
}

If no tasks found in a category, use empty array [].`;

export class TaskClassifier {
  private client: Anthropic | null = null;
  private model = 'claude-3-5-haiku-20241022';  // Fast and cheap
  private initialized = false;
  
  constructor(apiKey?: string) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (key) {
      this.client = new Anthropic({ apiKey: key });
      this.initialized = true;
    } else {
      console.log('[TaskClassifier] No API key - task extraction disabled');
    }
  }

  async classify(agentOutput: string): Promise<ClassificationResult> {
    // Skip if no API key configured
    if (!this.initialized || !this.client) {
      return { doing: [], planned: [], suggested: [], completed: [] };
    }
    
    // Skip very short outputs
    if (!agentOutput || agentOutput.trim().length < 20) {
      return { doing: [], planned: [], suggested: [], completed: [] };
    }

    // Truncate very long outputs to avoid token limits
    const truncated = agentOutput.length > 4000 
      ? agentOutput.slice(0, 4000) + '\n...[truncated]'
      : agentOutput;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `${CLASSIFIER_PROMPT}\n\n--- AGENT OUTPUT ---\n${truncated}\n--- END OUTPUT ---`,
          },
        ],
      });

      const text = response.content[0]?.type === 'text' 
        ? response.content[0].text 
        : '';

      // Parse JSON response
      const parsed = this.parseResponse(text);
      return { ...parsed, raw: text };

    } catch (error) {
      console.error('[TaskClassifier] Classification failed:', error);
      return { doing: [], planned: [], suggested: [], completed: [] };
    }
  }

  private parseResponse(text: string): Omit<ClassificationResult, 'raw'> {
    const empty = { doing: [], planned: [], suggested: [], completed: [] };
    
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = text.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      
      const parsed = JSON.parse(jsonStr);
      
      // Validate and normalize
      return {
        doing: this.normalizeTaskArray(parsed.doing),
        planned: this.normalizeTaskArray(parsed.planned),
        suggested: this.normalizeTaskArray(parsed.suggested),
        completed: this.normalizeTaskArray(parsed.completed),
      };
    } catch (error) {
      console.error('[TaskClassifier] Failed to parse response:', text);
      return empty;
    }
  }

  private normalizeTaskArray(arr: unknown): ExtractedTask[] {
    if (!Array.isArray(arr)) return [];
    
    return arr
      .filter((item): item is { text: string; confidence?: number } => 
        typeof item === 'object' && 
        item !== null && 
        typeof (item as any).text === 'string'
      )
      .map(item => ({
        text: item.text.trim(),
        category: 'planned' as const,  // Will be overwritten by caller
        confidence: typeof item.confidence === 'number' 
          ? Math.max(0, Math.min(1, item.confidence))
          : 0.5,
      }))
      .filter(task => task.text.length > 3);  // Filter out empty/tiny tasks
  }
}

// Singleton
let _classifier: TaskClassifier | null = null;

export function getTaskClassifier(): TaskClassifier {
  if (!_classifier) {
    _classifier = new TaskClassifier();
  }
  return _classifier;
}
