/**
 * Hook for semantic command search with debouncing and caching
 *
 * Provides async semantic search that complements the sync fuzzy search.
 * Results arrive after a debounce delay and are merged with fuzzy results.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getServerUrl } from '../stores/app';

export interface SemanticResult {
  commandId: string;
  score: number;
}

export interface UseSemanticSearchOptions {
  /** Debounce delay in ms (default: 300) */
  debounceMs?: number;
  /** Minimum query length to trigger search (default: 2) */
  minQueryLength?: number;
  /** Enable/disable the hook (default: true) */
  enabled?: boolean;
}

export interface UseSemanticSearchReturn {
  /** Semantic search results */
  results: SemanticResult[];
  /** Whether a search is in progress */
  isLoading: boolean;
  /** Error if search failed */
  error: Error | null;
  /** Whether results came from cache */
  cached: boolean;
  /** Search latency in ms */
  latencyMs: number;
}

export function useSemanticSearch(
  query: string,
  options: UseSemanticSearchOptions = {}
): UseSemanticSearchReturn {
  const {
    debounceMs = 300,
    minQueryLength = 2,
    enabled = true,
  } = options;

  const [results, setResults] = useState<SemanticResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [cached, setCached] = useState(false);
  const [latencyMs, setLatencyMs] = useState(0);

  // Track pending request for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (searchQuery: string) => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Clear results if query is too short
    if (!searchQuery.trim() || searchQuery.length < minQueryLength) {
      setResults([]);
      setIsLoading(false);
      setCached(false);
      setLatencyMs(0);
      return;
    }

    abortControllerRef.current = new AbortController();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${getServerUrl()}/api/commands/semantic-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery }),
        signal: abortControllerRef.current.signal,
      });

      const data = await response.json();

      if (data.ok) {
        setResults(data.results || []);
        setCached(data.cached || false);
        setLatencyMs(data.latencyMs || 0);
        setError(null);
      } else {
        // Service not ready or other non-fatal error
        setResults([]);
        setCached(false);
        setLatencyMs(0);
        // Don't set error for expected cases like service not initialized
        if (response.status !== 503) {
          setError(new Error(data.error || 'Search failed'));
        }
      }
    } catch (err) {
      // Ignore abort errors (expected when query changes)
      if ((err as Error).name !== 'AbortError') {
        setError(err as Error);
        setResults([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [minQueryLength]);

  useEffect(() => {
    if (!enabled) {
      setResults([]);
      setIsLoading(false);
      setCached(false);
      setLatencyMs(0);
      return;
    }

    // Clear previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Debounce the search
    timeoutRef.current = setTimeout(() => {
      search(query);
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [query, enabled, debounceMs, search]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { results, isLoading, error, cached, latencyMs };
}

/**
 * Initialize the semantic search service with command corpus.
 * Call this once on app startup after commands are registered.
 */
export async function initSemanticSearch(
  commands: Array<{
    id: string;
    label: string;
    description?: string;
    keywords?: string[];
    category: string;
  }>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${getServerUrl()}/api/commands/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    });

    const data = await response.json();
    return { ok: data.ok, error: data.error };
  } catch (err) {
    console.warn('[SemanticSearch] Failed to initialize:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to init' };
  }
}
