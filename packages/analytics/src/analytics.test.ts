import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { 
  createMockAnalytics, 
  createNoopAnalytics, 
  createAnalytics,
  MerryEvents,
  getTelemetryIdentifier,
  clearTelemetryIdentifier,
} from './index.js';

describe('MockAnalyticsService', () => {
  it('should record events', () => {
    const analytics = createMockAnalytics();
    
    analytics.record(MerryEvents.APP_LAUNCHED, { platform: 'darwin' });
    analytics.record(MerryEvents.SESSION_CREATED, { agentType: 'claude-code' });
    
    const events = analytics.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      event: 'app.launched',
      properties: { platform: 'darwin' },
    });
    expect(events[1]).toEqual({
      event: 'session.created',
      properties: { agentType: 'claude-code' },
    });
  });
  
  it('should clear events', () => {
    const analytics = createMockAnalytics();
    
    analytics.record(MerryEvents.APP_LAUNCHED);
    expect(analytics.getEvents()).toHaveLength(1);
    
    analytics.clearEvents();
    expect(analytics.getEvents()).toHaveLength(0);
  });
  
  it('should respect enabled state', () => {
    const analytics = createMockAnalytics();
    expect(analytics.isEnabled()).toBe(true);
    
    analytics.setEnabled(false);
    analytics.record(MerryEvents.APP_LAUNCHED);
    
    expect(analytics.isEnabled()).toBe(false);
    expect(analytics.getEvents()).toHaveLength(0);
  });
  
  it('should record events without properties', () => {
    const analytics = createMockAnalytics();
    
    analytics.record(MerryEvents.COMMAND_PALETTE_OPENED);
    
    const events = analytics.getEvents();
    expect(events[0]).toEqual({
      event: 'command_palette.opened',
      properties: undefined,
    });
  });
});

describe('NoopAnalyticsService', () => {
  it('should not throw when recording events', () => {
    const analytics = createNoopAnalytics();
    
    expect(() => {
      analytics.record(MerryEvents.APP_LAUNCHED, { platform: 'darwin' });
    }).not.toThrow();
  });
  
  it('should report as disabled', () => {
    const analytics = createNoopAnalytics();
    expect(analytics.isEnabled()).toBe(false);
  });
  
  it('should not throw on flush', async () => {
    const analytics = createNoopAnalytics();
    await expect(analytics.flush()).resolves.not.toThrow();
  });
  
  it('should not throw on shutdown', async () => {
    const analytics = createNoopAnalytics();
    await expect(analytics.shutdown()).resolves.not.toThrow();
  });
});

describe('createAnalytics', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  it('should return noop service when enabled is false', () => {
    const analytics = createAnalytics({
      posthogKey: 'test-key',
      appVersion: '0.1.0',
      clientType: 'desktop',
      enabled: false,
    });
    
    expect(analytics.isEnabled()).toBe(false);
  });
  
  it('should return noop service when MERRY_TELEMETRY_ENABLED is false', () => {
    process.env.MERRY_TELEMETRY_ENABLED = 'false';
    
    const analytics = createAnalytics({
      posthogKey: 'test-key',
      appVersion: '0.1.0',
      clientType: 'desktop',
    });
    
    expect(analytics.isEnabled()).toBe(false);
  });
  
  it('should return noop service when no posthog key', () => {
    const analytics = createAnalytics({
      posthogKey: '',
      appVersion: '0.1.0',
      clientType: 'desktop',
    });
    
    expect(analytics.isEnabled()).toBe(false);
  });
});

describe('getTelemetryIdentifier', () => {
  const testStateDir = path.join(os.tmpdir(), 'merry-test-' + Date.now());
  const originalHome = process.env.HOME;
  
  beforeEach(() => {
    // Use a temp directory for testing
    process.env.HOME = testStateDir;
    fs.mkdirSync(testStateDir, { recursive: true });
  });
  
  afterEach(() => {
    process.env.HOME = originalHome;
    // Clean up
    try {
      fs.rmSync(testStateDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });
  
  it('should return a hashed identifier', () => {
    const id = getTelemetryIdentifier();
    
    expect(id).not.toBeNull();
    expect(id).toHaveLength(64); // SHA-256 hex is 64 chars
  });
  
  it('should return the same identifier on subsequent calls', () => {
    const id1 = getTelemetryIdentifier();
    const id2 = getTelemetryIdentifier();
    
    expect(id1).toBe(id2);
  });
  
  it('should return different identifier after clearing', () => {
    const id1 = getTelemetryIdentifier();
    clearTelemetryIdentifier();
    const id2 = getTelemetryIdentifier();
    
    expect(id1).not.toBe(id2);
  });
});

describe('MerryEvents', () => {
  it('should have expected event names', () => {
    expect(MerryEvents.APP_LAUNCHED).toBe('app.launched');
    expect(MerryEvents.SESSION_CREATED).toBe('session.created');
    expect(MerryEvents.TASK_EXTRACTED).toBe('task.extracted');
    expect(MerryEvents.VIEW_CHANGED).toBe('view.changed');
  });
});
