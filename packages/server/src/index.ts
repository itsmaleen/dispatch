/**
 * Agent Command Center - Server
 * 
 * Provides:
 * - Adapter management (Claude Code, OpenClaw)
 * - WebSocket event streaming to UI
 * - Integration APIs (GitHub, CodeRabbit)
 */

export * from './adapters/claude-code';
export * from './adapters/openclaw';
export * from './adapters/types';
export * from './server';
