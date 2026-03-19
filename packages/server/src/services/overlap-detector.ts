/**
 * Overlap Detector Service
 *
 * Detects when multiple consoles are working on similar topics
 * to prevent duplicate/conflicting work.
 */

import { getTaskStore } from '../persistence/task-store';
import type { ConsoleThread } from '@acc/contracts';

// ============================================================================
// Types
// ============================================================================

export interface OverlapWarning {
  type: 'overlap';
  /** New thread that's overlapping */
  newThreadId: string;
  newThreadName: string;
  newConsoleId: string;
  /** Existing thread that it overlaps with */
  existingThreadId: string;
  existingThreadName: string;
  existingConsoleId: string;
  /** Similarity score (0-1) */
  similarity: number;
}

// ============================================================================
// OverlapDetector Class
// ============================================================================

export class OverlapDetector {
  /**
   * Check if a new thread overlaps with existing active threads
   */
  async checkOverlap(
    newThreadName: string,
    newConsoleId: string,
    newThreadId: string,
    projectPath: string
  ): Promise<OverlapWarning | null> {
    const taskStore = getTaskStore();

    // Get all active console threads for this project
    const activeThreads = taskStore.listConsoleThreads({
      status: 'active',
      projectPath,
    });

    // Filter out the new thread itself and threads on the same console
    const otherThreads = activeThreads.filter(
      t => t.id !== newThreadId && t.consoleId !== newConsoleId
    );

    if (otherThreads.length === 0) {
      return null;
    }

    // Check for overlaps
    for (const existingThread of otherThreads) {
      const similarity = this.calculateSimilarity(newThreadName, existingThread.name);

      // High similarity threshold - we want to avoid false positives
      if (similarity >= 0.7) {
        return {
          type: 'overlap',
          newThreadId,
          newThreadName,
          newConsoleId,
          existingThreadId: existingThread.id,
          existingThreadName: existingThread.name,
          existingConsoleId: existingThread.consoleId,
          similarity,
        };
      }
    }

    return null;
  }

  /**
   * Calculate similarity between two thread names
   * Uses a combination of exact match and word overlap
   */
  private calculateSimilarity(name1: string, name2: string): number {
    const n1 = this.normalize(name1);
    const n2 = this.normalize(name2);

    // Exact match
    if (n1 === n2) {
      return 1.0;
    }

    // Word-based Jaccard similarity
    const words1 = new Set(n1.split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(n2.split(/\s+/).filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) {
      return 0;
    }

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    const jaccard = intersection.size / union.size;

    // Also check for substring containment
    const containment = n1.includes(n2) || n2.includes(n1) ? 0.3 : 0;

    return Math.min(1, jaccard + containment);
  }

  /**
   * Normalize a thread name for comparison
   */
  private normalize(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _overlapDetector: OverlapDetector | null = null;

export function getOverlapDetector(): OverlapDetector {
  if (!_overlapDetector) {
    _overlapDetector = new OverlapDetector();
  }
  return _overlapDetector;
}
