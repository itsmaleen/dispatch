/**
 * Dispatch - Server
 *
 * Provides:
 * - Adapter management (Claude Code, OpenClaw)
 * - WebSocket event streaming to UI
 * - Integration APIs (GitHub, CodeRabbit)
 * - Terminal management (PTY sessions)
 */

export * from './adapters/claude-code';
export * from './adapters/openclaw';
export * from './adapters/types';
export * from './server';
export * from './services/terminal-manager';
export * from './services/terminal-tool';
export * from './analytics';
