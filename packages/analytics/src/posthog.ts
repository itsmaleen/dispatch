/**
 * PostHog analytics service implementation.
 * 
 * Based on T3Code's approach with buffered events and batch sending.
 */

import { PostHog } from 'posthog-node';
import type { AnalyticsConfig, AnalyticsService } from './types.js';
import { getTelemetryIdentifier } from './identify.js';

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const DEFAULT_FLUSH_BATCH_SIZE = 20;
const DEFAULT_MAX_BUFFERED_EVENTS = 1000;

export function createPostHogAnalytics(config: AnalyticsConfig): AnalyticsService {
  let enabled = config.enabled ?? true;
  const distinctId = getTelemetryIdentifier();
  
  // If we can't get an ID, disable telemetry
  if (!distinctId) {
    console.warn('[analytics] No telemetry identifier available, disabling analytics');
    enabled = false;
  }
  
  // Create PostHog client
  const client = new PostHog(config.posthogKey, {
    host: config.posthogHost ?? DEFAULT_POSTHOG_HOST,
    flushAt: config.flushBatchSize ?? DEFAULT_FLUSH_BATCH_SIZE,
    flushInterval: 1000, // 1 second
  });
  
  // Common properties added to all events
  const commonProperties = {
    $process_person_profile: false, // Don't create person profiles (privacy)
    platform: process.platform,
    arch: process.arch,
    appVersion: config.appVersion,
    clientType: config.clientType,
    nodeVersion: process.version,
  };
  
  const service: AnalyticsService = {
    record(event: string, properties?: Record<string, unknown>): void {
      if (!enabled || !distinctId) {
        return;
      }
      
      try {
        client.capture({
          distinctId,
          event,
          properties: {
            ...commonProperties,
            ...properties,
          },
        });
      } catch (error) {
        // Best-effort - don't let telemetry errors affect the app
        console.warn('[analytics] Failed to record event:', event, error);
      }
    },
    
    async flush(): Promise<void> {
      if (!enabled) {
        return;
      }
      
      try {
        await client.flush();
      } catch (error) {
        console.warn('[analytics] Failed to flush events:', error);
      }
    },
    
    async shutdown(): Promise<void> {
      try {
        await client.shutdown();
      } catch (error) {
        console.warn('[analytics] Failed to shutdown:', error);
      }
    },
    
    isEnabled(): boolean {
      return enabled;
    },
    
    setEnabled(value: boolean): void {
      enabled = value;
    },
  };
  
  return service;
}
