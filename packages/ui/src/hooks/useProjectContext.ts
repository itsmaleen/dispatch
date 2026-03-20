/**
 * useProjectContext - Hook to fetch and cache project context
 *
 * Analyzes a workspace directory to get project type, available scripts,
 * documentation presence, and suggested quick actions.
 *
 * Usage:
 *   const { context, isLoading, error, refresh } = useProjectContext(workspacePath);
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getServerUrl } from '../stores/app';
import type { ProjectContext } from '../types/quick-actions';

export interface UseProjectContextResult {
  context: ProjectContext | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

// Simple in-memory cache for project context
const contextCache = new Map<string, { context: ProjectContext; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute cache

export function useProjectContext(workspacePath: string | null): UseProjectContextResult {
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Track current fetch to avoid race conditions
  const fetchIdRef = useRef(0);

  const fetchContext = useCallback(async (path: string, ignoreCache: boolean = false) => {
    // Check cache first (unless ignoring)
    if (!ignoreCache) {
      const cached = contextCache.get(path);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setContext(cached.context);
        setIsLoading(false);
        setError(null);
        return;
      }
    }

    const currentFetchId = ++fetchIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${getServerUrl()}/project/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: path }),
      });

      // Check if this fetch is still relevant
      if (fetchIdRef.current !== currentFetchId) {
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to analyze project: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.ok) {
        throw new Error(data.error || 'Failed to analyze project');
      }

      // Update cache
      contextCache.set(path, {
        context: data.context,
        timestamp: Date.now(),
      });

      setContext(data.context);
      setError(null);
    } catch (err) {
      if (fetchIdRef.current === currentFetchId) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setContext(null);
      }
    } finally {
      if (fetchIdRef.current === currentFetchId) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch when workspace path changes
  useEffect(() => {
    if (!workspacePath) {
      setContext(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    fetchContext(workspacePath);
  }, [workspacePath, fetchContext]);

  // Manual refresh function
  const refresh = useCallback(() => {
    if (workspacePath) {
      fetchContext(workspacePath, true);
    }
  }, [workspacePath, fetchContext]);

  return {
    context,
    isLoading,
    error,
    refresh,
  };
}
