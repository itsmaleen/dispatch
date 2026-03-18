# Terminal Implementation Plan: Real Terminals + Agent Console Rename

> **Purpose**: Research and implementation plan for adding real terminal support and renaming the existing "terminal widget"
> **Created**: 2025-03-17
> **Status**: Draft

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Research Findings](#research-findings)
4. [Naming Decision: Terminal Widget Rename](#naming-decision-terminal-widget-rename)
5. [Architecture Design](#architecture-design)
6. [Implementation Plan](#implementation-plan)
7. [Technical Specifications](#technical-specifications)
8. [Open Questions](#open-questions)
9. [References](#references)

---

## Executive Summary

This document outlines the plan to:

1. **Rename the existing "terminal widget"** to "Agent Console" (or similar) to free up the "terminal" nomenclature
2. **Implement real terminal support** using xterm.js + node-pty, similar to VS Code and Cursor
3. **Enable agents to run persistent processes** (dev servers, watchers) that survive beyond tool call scope

**Key Motivation**: Currently, background processes started by Claude Code are cleaned up when the agent session ends. We need persistent terminals that:
- Allow agents to start long-running processes (dev servers, file watchers)
- Let users observe processes in real-time
- Enable agents to reference and interact with running terminals
- Support multiple concurrent terminals with clear identity

---

## Problem Statement

### Current Issues

1. **Background Process Cleanup**: Processes started via the Bash tool are cleaned up, making it impossible to keep dev servers running
2. **No Visual Feedback**: Users can't watch server output or logs in real-time
3. **Naming Confusion**: The "terminal widget" isn't actually a terminal - it's an agent output viewer
4. **No Process Persistence**: No way for agents to reference a terminal started earlier

### User Stories

- *"As a developer, I want to see my dev server output in real-time while the agent makes changes"*
- *"As a developer, I want agents to be able to start a process and check its output later"*
- *"As a developer, I want to manually interact with terminals that agents have started"*
- *"As a developer, I want clarity between 'agent output' and 'actual terminal'"*

---

## Research Findings

### How VS Code Implements Terminals

VS Code's terminal system is a three-layer architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                      xterm.js (Frontend)                     │
│  - Terminal emulator in the browser                         │
│  - Handles rendering, input, ANSI escape sequences          │
│  - Supports WebGL/Canvas/DOM rendering                      │
└─────────────────────────────────────────────────────────────┘
                              ↕ IPC
┌─────────────────────────────────────────────────────────────┐
│                    Terminal Process (Backend)                │
│  - node-pty spawns actual shell processes                   │
│  - Bidirectional I/O via PTY                                │
│  - Process lifecycle management                             │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                     Shell Process (OS)                       │
│  - bash, zsh, powershell, cmd                               │
│  - Actual command execution                                 │
└─────────────────────────────────────────────────────────────┘
```

**Key VS Code APIs:**

```typescript
// Create a terminal
const terminal = vscode.window.createTerminal({
  name: 'Dev Server',
  cwd: '/path/to/project',
  env: { NODE_ENV: 'development' }
});

// Send commands
terminal.sendText('npm run dev');

// Listen to events
vscode.window.onDidOpenTerminal(t => { /* ... */ });
vscode.window.onDidCloseTerminal(t => { /* ... */ });
vscode.window.onDidWriteTerminalData(e => { /* ... */ });
```

**VS Code Terminal Features:**
- Process reconnection on window reload
- Process revive on VS Code restart
- Terminal link providers (clickable links)
- Shell integration for enhanced features
- Profile system for different shell configurations

### How Cursor Handles Terminals

Cursor extends VS Code's terminal system with AI-specific features:

1. **Background Terminal Support**: Their terminal tool has an `is_background` parameter
   ```typescript
   {
     command: "npm run dev",
     is_background: true  // Process keeps running, doesn't block agent
   }
   ```

2. **Environment Configuration** (`.cursor/environment.json`):
   - Startup commands for Background Agents
   - Environment setup scripts
   - Snapshot settings for faster restarts

3. **Terminal Output in Context**: Agents can read terminal output as part of their context

**Cursor Pain Points** (from user reports):
- AI sometimes "forgets" terminal access between conversations
- Terminal context not always included in chat
- Manual copy-paste of terminal output still common

### xterm.js Capabilities

[xterm.js](https://github.com/xtermjs/xterm.js) is the de-facto standard for browser-based terminals:

**Core Features:**
- Full VT terminal emulation
- ANSI escape sequence support
- Unicode and wide character support
- GPU-accelerated rendering (WebGL addon)
- Auto-resize (fit addon)
- Search functionality
- Accessibility support

**Addons We'll Need:**
| Addon | Purpose |
|-------|---------|
| `@xterm/addon-fit` | Auto-resize to container |
| `@xterm/addon-webgl` | GPU-accelerated rendering |
| `@xterm/addon-search` | Search within terminal buffer |
| `@xterm/addon-web-links` | Clickable URLs |
| `@xterm/addon-serialize` | Save/restore buffer state |

### node-pty

[node-pty](https://github.com/microsoft/node-pty) provides PTY bindings for Node.js:

```typescript
import * as pty from 'node-pty';

const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';

const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-256color',
  cols: 80,
  rows: 30,
  cwd: process.env.HOME,
  env: process.env
});

ptyProcess.onData(data => {
  // Send to xterm.js frontend
  terminal.write(data);
});

// Write to PTY
ptyProcess.write('ls -la\r');
```

---

## Naming Decision: Terminal Widget Rename

### Current Naming

The existing "terminal widget" displays:
- Agent thinking process
- Tool calls and results
- Streaming output
- Chat input for prompts
- Execution state visualization

This is **NOT** a terminal - it's an **agent execution interface**.

### Recommended Names

| Rank | Name | Pros | Cons |
|------|------|------|------|
| 1 | **Agent Console** | Clear distinction, "console" implies output viewer | Minor terminal connotation |
| 2 | **Agent Session** | Accurate - it IS a session | Less visual/widget-like |
| 3 | **Agent Panel** | Simple, matches VS Code terminology | Generic |
| 4 | **Execution View** | Describes the content | Doesn't convey interactivity |
| 5 | **Agent Chat** | Clear for I/O nature | Undersells execution vis |

### Recommended Decision: **Agent Console**

**Rationale:**
- Clear visual metaphor (console = output window)
- Distinct from "terminal" (real shell)
- Familiar to developers (browser console, game console)
- Short, easy to reference in UI and code

### Rename Scope

Files/components to rename:

```
Current                          → New
─────────────────────────────────────────────────────────
TerminalWidget                   → AgentConsole
TerminalState                    → AgentConsoleState
TerminalSettings                 → AgentConsoleSettings
TerminalLine                     → ConsoleLine
TerminalLineType                 → ConsoleLineType
WidgetType: 'terminal'           → WidgetType: 'agent-console'
Commands: *-terminal             → Commands: *-console
```

---

## Architecture Design

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Agent Command Center                              │
├───────────────────────────────┬─────────────────────────────────────────┤
│      Agent Console(s)         │            Terminal(s)                  │
│      (existing, renamed)      │            (NEW)                        │
│                               │                                         │
│   ┌───────────────────────┐   │   ┌─────────────────────────────────┐   │
│   │ Agent thinking        │   │   │        xterm.js                 │   │
│   │ Tool calls/results    │   │   │   ┌─────────────────────────┐   │   │
│   │ Streaming output      │   │   │   │ $ npm run dev           │   │   │
│   │ Chat input            │   │   │   │ Server running on :3000 │   │   │
│   │                       │   │   │   │ Watching for changes... │   │   │
│   └───────────────────────┘   │   │   └─────────────────────────┘   │   │
│                               │   └─────────────────────────────────┘   │
└───────────────────────────────┴─────────────────────────────────────────┘
                                                    │
                                                    ▼
                                  ┌─────────────────────────────┐
                                  │    Terminal Manager (API)   │
                                  │                             │
                                  │   - Create/destroy terms    │
                                  │   - Send commands           │
                                  │   - Read output buffer      │
                                  │   - Named terminal refs     │
                                  └─────────────────────────────┘
                                                    │
                                                    ▼
                                  ┌─────────────────────────────┐
                                  │   PTY Process Manager       │
                                  │   (node-pty)                │
                                  │                             │
                                  │   - Spawn shell processes   │
                                  │   - Manage I/O streams      │
                                  │   - Process lifecycle       │
                                  └─────────────────────────────┘
```

### Component Design

#### 1. Terminal Widget (Frontend)

```typescript
interface TerminalWidgetProps {
  id: string;
  name: string;
  cwd?: string;
  shellPath?: string;
  env?: Record<string, string>;
  onData?: (data: string) => void;
  onExit?: (code: number) => void;
}

// Features:
// - xterm.js rendering
// - Resize handling
// - Copy/paste support
// - Search within buffer
// - Context menu (clear, kill, restart)
```

#### 2. Terminal Manager Service (Backend)

```typescript
interface TerminalInstance {
  id: string;
  name: string;
  pid: number;
  cwd: string;
  createdAt: Date;
  createdBy: 'user' | 'agent';
  agentId?: string;  // If created by an agent
  status: 'running' | 'exited';
  exitCode?: number;
}

interface TerminalManager {
  // Lifecycle
  create(options: CreateTerminalOptions): Promise<TerminalInstance>;
  destroy(id: string): Promise<void>;
  list(): Promise<TerminalInstance[]>;
  get(id: string): Promise<TerminalInstance | null>;

  // I/O
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;

  // Output access (for agents)
  getRecentOutput(id: string, lines?: number): Promise<string>;
  waitForOutput(id: string, pattern: RegExp, timeout?: number): Promise<string>;

  // Events
  onData(id: string, callback: (data: string) => void): Disposable;
  onExit(id: string, callback: (code: number) => void): Disposable;
}
```

#### 3. Agent Terminal Tool

New tool for agents to interact with terminals:

```typescript
interface TerminalToolInput {
  action: 'create' | 'write' | 'read' | 'close' | 'list';

  // For 'create'
  name?: string;
  cwd?: string;
  command?: string;  // Initial command to run

  // For 'write'
  terminalId?: string;
  terminalName?: string;  // Alternative to ID
  input: string;

  // For 'read'
  lines?: number;  // Last N lines
  waitFor?: string;  // Wait for pattern
  timeout?: number;

  // For 'close'
  signal?: 'SIGTERM' | 'SIGKILL';
}

interface TerminalToolOutput {
  success: boolean;
  terminalId?: string;
  output?: string;
  error?: string;
}
```

**Example Agent Usage:**

```typescript
// Start a dev server
await terminalTool({
  action: 'create',
  name: 'dev-server',
  cwd: '/project',
  command: 'npm run dev'
});

// Check if server is ready
const output = await terminalTool({
  action: 'read',
  terminalName: 'dev-server',
  waitFor: 'ready on',
  timeout: 30000
});

// Run tests in a new terminal
await terminalTool({
  action: 'create',
  name: 'test-runner',
  command: 'npm test'
});
```

### Data Flow

```
┌──────────┐    WebSocket     ┌──────────────┐     PTY      ┌───────────┐
│  UI      │ ←───────────────→│   API        │←────────────→│  Shell    │
│ (xterm)  │                  │   Server     │              │  Process  │
└──────────┘                  └──────────────┘              └───────────┘
     ↑                               ↑
     │                               │
     │ User Input                    │ Agent Commands
     │                               │
     ↓                               ↓
┌──────────┐                  ┌──────────────┐
│  User    │                  │   Agent      │
└──────────┘                  └──────────────┘
```

---

## Implementation Plan

### Phase 0: Widget Rename (Pre-requisite)

**Goal**: Rename "terminal" to "agent console" throughout the codebase

**Scope**:
| Current | New |
|---------|-----|
| `TerminalWidget` | `AgentConsole` |
| `TerminalState` | `AgentConsoleState` |
| `TerminalSettings` | `AgentConsoleSettings` |
| `TerminalLine` | `ConsoleLine` |
| `TerminalLineType` | `ConsoleLineType` |
| `WidgetType: 'terminal'` | `WidgetType: 'agent-console'` |
| `new-terminal` command | `new-console` command |
| `close-terminal` command | `close-console` command |
| `clear-terminal` command | `clear-console` command |
| UI label "Terminal" | UI label "Agent Console" |

**Files to Update**:
- `packages/ui/src/components/workspace/Workspace.tsx`
- `packages/ui/src/stores/workspace.ts`
- `packages/ui/src/lib/commands/default-commands.ts`
- `packages/contracts/src/widget.ts`
- Any other files referencing terminal nomenclature

**Effort**: ~2-4 hours

---

### Phase 1: Infrastructure Setup

**Goal**: Set up the foundation for real terminal support

**Tasks**:

1. **Install Dependencies**
   ```bash
   # Frontend
   bun add xterm @xterm/addon-fit @xterm/addon-webgl @xterm/addon-search @xterm/addon-web-links

   # Backend
   bun add node-pty
   ```

2. **Create Terminal Manager Service**
   - File: `packages/api/src/services/terminal-manager.ts`
   - Responsibilities:
     - Spawn/track PTY processes
     - Manage process lifecycle
     - Buffer recent output for agent access

3. **Create WebSocket Handler for Terminal I/O**
   - File: `packages/api/src/handlers/terminal-ws.ts`
   - Real-time bidirectional communication
   - Multiple terminal multiplexing

4. **Define Contracts**
   - File: `packages/contracts/src/terminal.ts`
   - Terminal instance interface
   - Terminal events
   - API types

**Effort**: ~1-2 days

---

### Phase 2: Basic Terminal Widget

**Goal**: Create a functional terminal widget in the UI

**Tasks**:

1. **Create Terminal Component**
   - File: `packages/ui/src/components/workspace/Terminal.tsx`
   - xterm.js integration
   - Fit addon for auto-resize
   - WebGL addon for performance

2. **Add Terminal to Layout System**
   - Update `WidgetType` to include `'terminal'`
   - Add terminal widget rendering in Workspace
   - Support split/maximize/minimize

3. **Terminal Title Bar**
   - Process name/ID
   - Working directory
   - Kill/restart buttons
   - Shell selector (future)

4. **Keyboard Handling**
   - Standard terminal shortcuts
   - Copy/paste
   - Search (Ctrl+Shift+F)

**Effort**: ~2-3 days

---

### Phase 3: Terminal Management API

**Goal**: Enable programmatic terminal control

**Tasks**:

1. **REST API Endpoints**
   ```
   POST   /api/terminals           - Create terminal
   GET    /api/terminals           - List terminals
   GET    /api/terminals/:id       - Get terminal info
   DELETE /api/terminals/:id       - Close terminal
   POST   /api/terminals/:id/write - Send input
   GET    /api/terminals/:id/output - Get recent output
   ```

2. **WebSocket Events**
   ```typescript
   // Client → Server
   { type: 'terminal:input', terminalId: string, data: string }
   { type: 'terminal:resize', terminalId: string, cols: number, rows: number }

   // Server → Client
   { type: 'terminal:output', terminalId: string, data: string }
   { type: 'terminal:exit', terminalId: string, code: number }
   { type: 'terminal:created', terminal: TerminalInstance }
   { type: 'terminal:closed', terminalId: string }
   ```

3. **Command Palette Integration**
   - `new-terminal` - Create new terminal
   - `close-terminal` - Close active terminal
   - `clear-terminal` - Clear terminal buffer
   - `kill-process` - Send SIGKILL to process

**Effort**: ~2-3 days

---

### Phase 4: Agent Terminal Tool

**Goal**: Let agents create and interact with terminals

**Tasks**:

1. **Define Terminal Tool Schema**
   - Actions: create, write, read, close, list
   - Support named terminals for easy reference
   - Pattern matching for output waiting

2. **Implement Tool Handler**
   - File: `packages/api/src/tools/terminal.ts`
   - Integration with Terminal Manager
   - Output buffering for agent access

3. **Context Integration**
   - Include terminal status in agent context
   - Recent output summaries
   - Process health indicators

4. **Background Process Support**
   - `is_background` flag for non-blocking commands
   - Automatic output monitoring
   - Process status reporting

**Example Agent Interaction:**
```
Agent: I'll start the dev server for you.

[Creates terminal "dev-server" with command "npm run dev"]

Agent: The server is starting. Let me wait for it to be ready...

[Reads terminal output, waits for "ready on localhost:3000"]

Agent: The dev server is now running at localhost:3000. I'll keep it running while I make changes to the code.
```

**Effort**: ~2-3 days

---

### Phase 5: Polish & Integration

**Goal**: Production-ready terminal experience

**Tasks**:

1. **Terminal Persistence**
   - Reconnect to terminals after page reload
   - Restore terminal buffer state
   - Process reconnection (if still running)

2. **Multi-Terminal UX**
   - Tab bar for multiple terminals
   - Drag-and-drop reordering
   - Split terminal view

3. **Shell Integration**
   - Working directory tracking
   - Command history
   - Exit code indicators

4. **Performance Optimization**
   - WebGL rendering
   - Output throttling
   - Large buffer handling

5. **Accessibility**
   - Screen reader support
   - Keyboard navigation
   - High contrast themes

**Effort**: ~2-3 days

---

### Timeline Summary

| Phase | Description | Effort | Dependencies |
|-------|-------------|--------|--------------|
| 0 | Widget Rename | 2-4 hours | None |
| 1 | Infrastructure | 1-2 days | Phase 0 |
| 2 | Basic Terminal | 2-3 days | Phase 1 |
| 3 | Management API | 2-3 days | Phase 2 |
| 4 | Agent Tool | 2-3 days | Phase 3 |
| 5 | Polish | 2-3 days | Phase 4 |

**Total Estimated Effort**: ~2-3 weeks

---

## Technical Specifications

### Dependencies

```json
{
  "dependencies": {
    // Frontend
    "xterm": "^5.3.0",
    "@xterm/addon-fit": "^0.8.0",
    "@xterm/addon-webgl": "^0.16.0",
    "@xterm/addon-search": "^0.13.0",
    "@xterm/addon-web-links": "^0.9.0",
    "@xterm/addon-serialize": "^0.11.0",

    // Backend
    "node-pty": "^1.0.0"
  }
}
```

### Terminal Instance Schema

```typescript
interface TerminalInstance {
  id: string;                    // UUID
  name: string;                  // User-friendly name
  pid: number;                   // OS process ID
  cwd: string;                   // Working directory
  shell: string;                 // Shell path (bash, zsh, etc.)
  env: Record<string, string>;   // Environment variables
  cols: number;                  // Terminal columns
  rows: number;                  // Terminal rows

  createdAt: Date;
  createdBy: 'user' | 'agent';
  agentId?: string;              // If created by agent
  agentSessionId?: string;       // Associated agent session

  status: 'running' | 'exited';
  exitCode?: number;
  exitSignal?: string;

  // Metadata
  labels?: Record<string, string>;  // User-defined labels
}
```

### WebSocket Protocol

```typescript
// Terminal-specific WebSocket messages
type TerminalMessage =
  | { type: 'terminal:attach', terminalId: string }
  | { type: 'terminal:detach', terminalId: string }
  | { type: 'terminal:input', terminalId: string, data: string }
  | { type: 'terminal:resize', terminalId: string, cols: number, rows: number }
  | { type: 'terminal:output', terminalId: string, data: string }
  | { type: 'terminal:exit', terminalId: string, code: number, signal?: string }
  | { type: 'terminal:error', terminalId: string, error: string };
```

### Agent Tool Schema

```typescript
const terminalToolSchema = {
  name: 'terminal',
  description: 'Create and interact with terminal processes',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'write', 'read', 'close', 'list'],
        description: 'The action to perform'
      },
      name: {
        type: 'string',
        description: 'Human-readable name for the terminal'
      },
      terminalId: {
        type: 'string',
        description: 'Terminal ID (alternative to name)'
      },
      terminalName: {
        type: 'string',
        description: 'Terminal name to reference (alternative to ID)'
      },
      cwd: {
        type: 'string',
        description: 'Working directory for new terminal'
      },
      command: {
        type: 'string',
        description: 'Initial command to run'
      },
      input: {
        type: 'string',
        description: 'Input to send to terminal'
      },
      lines: {
        type: 'number',
        description: 'Number of recent lines to read'
      },
      waitFor: {
        type: 'string',
        description: 'Pattern to wait for in output'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds'
      },
      isBackground: {
        type: 'boolean',
        description: 'Keep terminal running without blocking'
      }
    },
    required: ['action']
  }
};
```

---

## Open Questions

### Technical

- [ ] **Buffer Limits**: How much terminal output should we buffer? VS Code uses ~10,000 lines by default
- [ ] **Process Cleanup**: When should orphaned terminals be cleaned up? After session end? After timeout?
- [ ] **Windows Support**: node-pty supports Windows, but are there edge cases to handle?
- [ ] **Performance**: How do we handle very high output volume (e.g., webpack builds)?

### Product

- [ ] **Terminal Naming**: Should we auto-generate names or require user input?
- [ ] **Agent Permissions**: Should agents need approval to create terminals?
- [ ] **Terminal Sharing**: Can multiple agents share a terminal?
- [ ] **History Persistence**: Should terminal history persist across restarts?

### Integration

- [ ] **Claude Code Bash Tool**: How does this interact with the existing Bash tool? Replace or complement?
- [ ] **MCP Integration**: Should terminals be exposed as MCP resources?
- [ ] **Session Association**: How tightly coupled should terminals be to agent sessions?

---

## References

### External Resources

- [xterm.js Documentation](https://xtermjs.org/docs/)
- [xterm.js GitHub](https://github.com/xtermjs/xterm.js)
- [node-pty GitHub](https://github.com/microsoft/node-pty)
- [VS Code Terminal API Sample](https://github.com/microsoft/vscode-extension-samples/blob/main/terminal-sample/src/extension.ts)
- [VS Code Terminal Source](https://github.com/microsoft/vscode/tree/main/src/vs/workbench/contrib/terminal)
- [VS Code xterm.js Integration Wiki](https://github.com/microsoft/vscode-wiki/blob/main/Working-with-xterm.js.md)
- [Cursor Background Agents](https://docs.cursor.com/en/background-agent)

### Internal Documents

- `docs/MULTI-AGENT-IDE-RESEARCH.md` - Overall product research
- `docs/AGENT-ROUTING-SPEC.md` - Agent routing design
- `docs/EXECUTION-STATE-UI-SPEC.md` - Activity feed design

---

## Appendix: VS Code Terminal Sample Code

From [vscode-extension-samples](https://github.com/microsoft/vscode-extension-samples/blob/main/terminal-sample/src/extension.ts):

```typescript
// Basic terminal creation
const terminal = vscode.window.createTerminal(`Ext Terminal #${NEXT_TERM_ID++}`);

// Hidden terminal
const terminal = vscode.window.createTerminal({
  name: `Ext Terminal #${NEXT_TERM_ID++}`,
  hideFromUser: true
});

// Send text to terminal
terminal.sendText("echo 'Hello world!'");

// Terminal events
vscode.window.onDidOpenTerminal(terminal => {
  console.log('Terminal opened:', terminal.name);
});

vscode.window.onDidCloseTerminal(terminal => {
  console.log('Terminal closed:', terminal.name);
});

vscode.window.onDidChangeActiveTerminal(terminal => {
  console.log('Active terminal changed:', terminal?.name);
});
```

---

*Document maintained by: Agent Command Center Team*
*Last updated: 2025-03-17*
