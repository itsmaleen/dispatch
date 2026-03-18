/**
 * Terminal Tool for Agents
 *
 * Provides a tool interface for AI agents to interact with real PTY terminals.
 * This allows agents to:
 * - Create new terminals
 * - Run commands (foreground or background)
 * - Read terminal output
 * - Wait for specific patterns in output
 * - Close terminals
 *
 * Based on the is_background pattern from Cursor for non-blocking commands.
 */

import type { TerminalToolInput, TerminalToolOutput, TerminalInstance } from '@acc/contracts';
import { getTerminalManager, type TerminalManager } from './terminal-manager';

/**
 * Execute a terminal tool action
 */
export async function executeTerminalTool(
  input: TerminalToolInput,
  options?: { sessionId?: string; agentId?: string }
): Promise<TerminalToolOutput> {
  const manager = getTerminalManager();

  switch (input.action) {
    case 'create':
      return handleCreate(manager, input, options);
    case 'write':
      return handleWrite(manager, input);
    case 'read':
      return handleRead(manager, input);
    case 'wait':
      return handleWait(manager, input);
    case 'close':
      return handleClose(manager, input);
    case 'list':
      return handleList(manager);
    default:
      return {
        success: false,
        error: `Unknown action: ${(input as any).action}`,
      };
  }
}

/**
 * Create a new terminal
 */
async function handleCreate(
  manager: TerminalManager,
  input: TerminalToolInput,
  options?: { sessionId?: string; agentId?: string }
): Promise<TerminalToolOutput> {
  try {
    const terminal = manager.create({
      name: input.name,
      cwd: input.cwd,
      createdBy: 'agent',
      agentId: options?.agentId,
      sessionId: options?.sessionId,
      initialCommand: input.command,
    });

    // If not running in background, wait for initial command to complete
    if (input.command && !input.isBackground) {
      // Wait for a prompt or short timeout
      const { matched, output } = await manager.waitForOutput(
        terminal.id,
        /[$#>]\s*$/,
        10000 // 10 second timeout for initial command
      );

      return {
        success: true,
        terminalId: terminal.id,
        terminalName: terminal.name,
        output: matched ? output : undefined,
      };
    }

    return {
      success: true,
      terminalId: terminal.id,
      terminalName: terminal.name,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create terminal',
    };
  }
}

/**
 * Write input to a terminal
 */
async function handleWrite(
  manager: TerminalManager,
  input: TerminalToolInput
): Promise<TerminalToolOutput> {
  const terminal = resolveTerminal(manager, input);
  if (!terminal) {
    return {
      success: false,
      error: `Terminal not found: ${input.terminalId || input.terminalName}`,
    };
  }

  if (!input.input) {
    return {
      success: false,
      error: 'No input provided',
    };
  }

  // Append newline if not present
  const data = input.input.endsWith('\n') ? input.input : input.input + '\n';
  const success = manager.write(terminal.id, data);

  if (!success) {
    return {
      success: false,
      error: 'Failed to write to terminal (terminal may have exited)',
    };
  }

  // If not running in background, wait for command to complete
  if (!input.isBackground) {
    const timeout = input.timeout || 30000;
    const { matched, output } = await manager.waitForOutput(
      terminal.id,
      input.waitFor ? new RegExp(input.waitFor) : /[$#>]\s*$/,
      timeout
    );

    return {
      success: true,
      terminalId: terminal.id,
      terminalName: terminal.name,
      output,
      matched: input.waitFor ? matched : undefined,
    };
  }

  return {
    success: true,
    terminalId: terminal.id,
    terminalName: terminal.name,
  };
}

/**
 * Read recent output from a terminal
 */
function handleRead(
  manager: TerminalManager,
  input: TerminalToolInput
): TerminalToolOutput {
  const terminal = resolveTerminal(manager, input);
  if (!terminal) {
    return {
      success: false,
      error: `Terminal not found: ${input.terminalId || input.terminalName}`,
    };
  }

  const output = manager.getRecentOutput(terminal.id, input.lines || 50);
  if (output === null) {
    return {
      success: false,
      error: 'Failed to read terminal output',
    };
  }

  return {
    success: true,
    terminalId: terminal.id,
    terminalName: terminal.name,
    output,
  };
}

/**
 * Wait for a pattern to appear in terminal output
 */
async function handleWait(
  manager: TerminalManager,
  input: TerminalToolInput
): Promise<TerminalToolOutput> {
  const terminal = resolveTerminal(manager, input);
  if (!terminal) {
    return {
      success: false,
      error: `Terminal not found: ${input.terminalId || input.terminalName}`,
    };
  }

  if (!input.waitFor) {
    return {
      success: false,
      error: 'No pattern provided (waitFor is required)',
    };
  }

  const { matched, output } = await manager.waitForOutput(
    terminal.id,
    new RegExp(input.waitFor),
    input.timeout || 30000
  );

  return {
    success: true,
    terminalId: terminal.id,
    terminalName: terminal.name,
    output,
    matched,
  };
}

/**
 * Close a terminal
 */
function handleClose(
  manager: TerminalManager,
  input: TerminalToolInput
): TerminalToolOutput {
  const terminal = resolveTerminal(manager, input);
  if (!terminal) {
    return {
      success: false,
      error: `Terminal not found: ${input.terminalId || input.terminalName}`,
    };
  }

  const success = manager.close(terminal.id);
  return {
    success,
    terminalId: terminal.id,
    terminalName: terminal.name,
    error: success ? undefined : 'Failed to close terminal',
  };
}

/**
 * List all terminals
 */
function handleList(manager: TerminalManager): TerminalToolOutput {
  const terminals = manager.list();
  return {
    success: true,
    terminals: terminals.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      cwd: t.cwd,
    })),
  };
}

/**
 * Resolve a terminal by ID or name
 */
function resolveTerminal(
  manager: TerminalManager,
  input: TerminalToolInput
): TerminalInstance | null {
  if (input.terminalId) {
    return manager.get(input.terminalId);
  }
  if (input.terminalName) {
    return manager.getByName(input.terminalName);
  }
  return null;
}

/**
 * Create a JSON schema for the terminal tool
 * This can be used to register the tool with AI agents
 */
export function getTerminalToolSchema() {
  return {
    name: 'terminal',
    description: `Interact with real shell terminals. Use this to run commands, start background processes (like dev servers), and manage terminal sessions.

Actions:
- create: Create a new terminal with optional initial command
- write: Send input to a terminal (runs a command)
- read: Get recent output from a terminal
- wait: Wait for a specific pattern to appear in output
- close: Close a terminal
- list: List all terminals

For long-running processes (dev servers, watchers), use isBackground: true to run commands without waiting.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'write', 'read', 'close', 'list', 'wait'],
          description: 'The action to perform',
        },
        terminalId: {
          type: 'string',
          description: 'Terminal ID (for write, read, close, wait actions)',
        },
        terminalName: {
          type: 'string',
          description: 'Terminal name (alternative to ID)',
        },
        name: {
          type: 'string',
          description: 'Name for the new terminal (create action)',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (create action)',
        },
        command: {
          type: 'string',
          description: 'Initial command to run (create action)',
        },
        input: {
          type: 'string',
          description: 'Input to send to the terminal (write action)',
        },
        lines: {
          type: 'number',
          description: 'Number of recent lines to read (read action, default: 50)',
        },
        waitFor: {
          type: 'string',
          description: 'Regex pattern to wait for in output (wait action)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (wait action, default: 30000)',
        },
        isBackground: {
          type: 'boolean',
          description: 'Run command in background without waiting (for dev servers, watchers, etc.)',
        },
      },
      required: ['action'],
    },
  };
}

export default executeTerminalTool;
