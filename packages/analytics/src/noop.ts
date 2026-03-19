/**
 * No-op analytics service for testing and when telemetry is disabled.
 */

import type { AnalyticsService } from './types.js';

/**
 * Create a no-op analytics service that does nothing.
 * Useful for testing or when telemetry is disabled.
 */
export function createNoopAnalytics(): AnalyticsService {
  return {
    record(_event: string, _properties?: Record<string, unknown>): void {
      // No-op
    },
    
    async flush(): Promise<void> {
      // No-op
    },
    
    async shutdown(): Promise<void> {
      // No-op
    },
    
    isEnabled(): boolean {
      return false;
    },
    
    setEnabled(_enabled: boolean): void {
      // No-op
    },
  };
}

/**
 * Create a mock analytics service that records events in memory.
 * Useful for testing that events are fired correctly.
 */
export interface MockAnalyticsService extends AnalyticsService {
  /** Get all recorded events */
  getEvents(): Array<{ event: string; properties?: Record<string, unknown> }>;
  /** Clear recorded events */
  clearEvents(): void;
}

export function createMockAnalytics(): MockAnalyticsService {
  const events: Array<{ event: string; properties?: Record<string, unknown> }> = [];
  let enabled = true;
  
  return {
    record(event: string, properties?: Record<string, unknown>): void {
      if (enabled) {
        events.push({ event, properties });
      }
    },
    
    async flush(): Promise<void> {
      // No-op for mock
    },
    
    async shutdown(): Promise<void> {
      // No-op for mock
    },
    
    isEnabled(): boolean {
      return enabled;
    },
    
    setEnabled(value: boolean): void {
      enabled = value;
    },
    
    getEvents(): Array<{ event: string; properties?: Record<string, unknown> }> {
      return [...events];
    },
    
    clearEvents(): void {
      events.length = 0;
    },
  };
}
