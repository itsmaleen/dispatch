/**
 * Analytics integration for the Command Center server.
 * 
 * Initializes telemetry and provides a global analytics instance.
 */

import { 
  createAnalyticsFromEnv, 
  createNoopAnalytics,
  type AnalyticsService,
  DispatchEvents,
} from '@dispatch/analytics';

// Re-export events for convenience
export { DispatchEvents } from '@dispatch/analytics';

let analytics: AnalyticsService | null = null;

/**
 * Initialize the analytics service.
 * Should be called once at server startup.
 */
export function initAnalytics(options: {
  appVersion: string;
  clientType?: 'desktop' | 'cli';
}): AnalyticsService {
  if (analytics) {
    return analytics;
  }
  
  analytics = createAnalyticsFromEnv({
    appVersion: options.appVersion,
    clientType: options.clientType ?? 'desktop',
  });
  
  return analytics;
}

/**
 * Get the analytics service instance.
 * Returns a no-op service if not initialized.
 */
export function getAnalytics(): AnalyticsService {
  if (!analytics) {
    return createNoopAnalytics();
  }
  return analytics;
}

/**
 * Shutdown analytics and flush remaining events.
 * Should be called at server shutdown.
 */
export async function shutdownAnalytics(): Promise<void> {
  if (analytics) {
    await analytics.shutdown();
    analytics = null;
  }
}
