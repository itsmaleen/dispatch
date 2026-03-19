/**
 * @dispatch/analytics - Anonymous telemetry for Dispatch
 * 
 * Usage:
 * ```typescript
 * import { createAnalytics, DispatchEvents } from '@dispatch/analytics';
 * 
 * const analytics = createAnalytics({
 *   posthogKey: process.env.DISPATCH_POSTHOG_KEY!,
 *   appVersion: '0.1.0',
 *   clientType: 'desktop',
 * });
 * 
 * analytics.record(DispatchEvents.APP_LAUNCHED, {
 *   platform: process.platform,
 * });
 * 
 * // On shutdown
 * await analytics.shutdown();
 * ```
 * 
 * Environment variables:
 * - DISPATCH_POSTHOG_KEY: PostHog project API key
 * - DISPATCH_POSTHOG_HOST: PostHog host (default: https://us.i.posthog.com)
 * - DISPATCH_TELEMETRY_ENABLED: Enable/disable telemetry (default: true)
 */

export * from './types.js';
export { createPostHogAnalytics } from './posthog.js';
export { createNoopAnalytics, createMockAnalytics, type MockAnalyticsService } from './noop.js';
export { getTelemetryIdentifier, clearTelemetryIdentifier } from './identify.js';

import type { AnalyticsConfig, AnalyticsService } from './types.js';
import { createPostHogAnalytics } from './posthog.js';
import { createNoopAnalytics } from './noop.js';

/**
 * Create an analytics service based on configuration.
 * 
 * If telemetry is disabled (via config or environment), returns a no-op service.
 * 
 * Environment variables:
 * - DISPATCH_TELEMETRY_ENABLED: Set to 'false' to disable telemetry
 */
export function createAnalytics(config: AnalyticsConfig): AnalyticsService {
  // Check environment for telemetry disable
  const envEnabled = process.env.DISPATCH_TELEMETRY_ENABLED;
  const isEnabled = config.enabled !== false && envEnabled !== 'false';
  
  if (!isEnabled) {
    return createNoopAnalytics();
  }
  
  // Check for PostHog key
  if (!config.posthogKey) {
    console.warn('[analytics] No PostHog key provided, disabling telemetry');
    return createNoopAnalytics();
  }
  
  return createPostHogAnalytics(config);
}

/**
 * Create analytics from environment variables.
 * 
 * Required environment variables:
 * - DISPATCH_POSTHOG_KEY: PostHog project API key
 * 
 * Optional environment variables:
 * - DISPATCH_POSTHOG_HOST: PostHog host (default: https://us.i.posthog.com)
 * - DISPATCH_TELEMETRY_ENABLED: Enable/disable telemetry (default: true)
 */
export function createAnalyticsFromEnv(options: {
  appVersion: string;
  clientType: 'desktop' | 'cli';
}): AnalyticsService {
  const posthogKey = process.env.DISPATCH_POSTHOG_KEY;
  
  if (!posthogKey) {
    console.warn('[analytics] DISPATCH_POSTHOG_KEY not set, disabling telemetry');
    return createNoopAnalytics();
  }
  
  return createAnalytics({
    posthogKey,
    posthogHost: process.env.DISPATCH_POSTHOG_HOST,
    enabled: process.env.DISPATCH_TELEMETRY_ENABLED !== 'false',
    appVersion: options.appVersion,
    clientType: options.clientType,
  });
}
