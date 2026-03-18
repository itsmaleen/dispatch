# Terminal Feature Status

## Overview

Real PTY-based terminals are now functional in the Agent Command Center. This document captures the current implementation status and future improvement opportunities.

**Last Updated**: March 2025

---

## Current Status: MVP Complete

The terminal feature provides a working shell experience within the application, supporting real-time I/O, multiple terminals, and layout integration.

### What's Working

#### Server-Side
- **PTY Management** (`terminal-manager.ts`)
  - Terminal creation with configurable shell, CWD, and environment
  - Process I/O with output buffering (10,000 lines / 5MB)
  - Shell auto-detection (bash/zsh on macOS/Linux, cmd on Windows)
  - Multiple client attachment to same terminal
  - Proper cleanup on terminal close

- **REST API** (all endpoints functional)
  - `GET /api/terminals` - List all terminals
  - `POST /api/terminals` - Create new terminal
  - `GET /api/terminals/:id` - Get terminal info
  - `GET /api/terminals/:id/output` - Fetch recent output
  - `POST /api/terminals/:id/write` - Send input
  - `POST /api/terminals/:id/resize` - Resize terminal
  - `DELETE /api/terminals/:id` - Close terminal

- **WebSocket Support**
  - Real-time bidirectional I/O streaming
  - Terminal attach/detach for multiple viewers
  - Resize event propagation
  - Exit/error event broadcasting

- **Agent Terminal Tool** (`terminal-tool.ts`)
  - Agents can create, write, read, and close terminals
  - Named terminal references
  - Background execution support
  - Pattern matching with `waitForOutput()`

#### Client-Side
- **TerminalWidget** (`TerminalWidget.tsx`)
  - Full xterm.js integration with proper rendering
  - FitAddon for responsive resizing
  - WebLinksAddon for clickable URLs
  - SearchAddon with search bar UI
  - Dark theme matching AgentConsoleWidget
  - Traffic light buttons (close/minimize/maximize)
  - Drag handle for layout reordering
  - Connection status indicator
  - CWD display in title bar

- **Layout Integration**
  - Terminals work as layout widgets
  - Drag-and-drop between columns
  - Resize handles via react-resizable-panels
  - Layout presets include terminals
  - Command palette: "New Terminal" command

---

## Missing Features

### Critical (For Production Use)

#### 1. Terminal Persistence
**Impact**: Terminals are lost on page refresh or server restart

Currently, terminals exist only in memory. There's no database table to persist terminal metadata.

**To implement**:
- Add `terminals` table to database (migration 5)
- Store: id, name, cwd, shell, status, workspaceId, createdAt
- On server start, attempt to reconnect to existing PTY processes (or mark as disconnected)
- On client reconnect, restore terminal widgets from database

#### 2. Workspace Scoping
**Impact**: Terminals leak between projects

Terminals are currently global - they're not associated with a specific workspace.

**To implement**:
- Add `workspaceId` field to terminal creation
- Filter terminal list by current workspace
- Auto-cleanup when switching workspaces (or keep running in background)

#### 3. Reconnection Support
**Impact**: WebSocket drops lose terminal connection

If the WebSocket disconnects, the terminal widget can't reconnect to receive output.

**To implement**:
- Add reconnection logic in TerminalWidget
- Request buffered output on reconnect via `getRecentOutput()`
- Show "Reconnecting..." status in UI
- Auto-reconnect with exponential backoff

### High Priority (Quality of Life)

#### 4. Terminal Naming
**Current**: Auto-generated names ("Terminal 1", "Terminal 2")

**To implement**:
- Double-click title to rename
- `PATCH /api/terminals/:id` endpoint for updates
- Store custom name in terminal metadata

#### 5. Exit Status Display
**Current**: Message printed in terminal, no visual indicator

**To implement**:
- Show exit code in title bar (e.g., "Terminal 1 [exit: 0]")
- Color indicator: green for 0, red for non-zero
- "Restart" button for exited terminals

#### 6. Terminal List/Switcher
**Current**: Must use layout to find terminals

**To implement**:
- Terminal list panel or dropdown
- Keyboard shortcut to cycle terminals
- Quick filter/search

### Medium Priority (Polish)

#### 7. Context Menu
Right-click actions:
- Kill process (SIGTERM/SIGKILL)
- Restart terminal
- Clear buffer
- Copy all / Copy selection
- Split terminal

#### 8. Shell Selection
**Current**: Uses system default shell

**To implement**:
- Shell selector dropdown in "New Terminal" flow
- Common shells: bash, zsh, fish, sh
- Custom shell path support
- Per-workspace default shell preference

#### 9. Terminal Tabs
**Current**: Each terminal is a separate widget

Alternative UI pattern:
- Single terminal panel with tabs
- Tab bar with terminal names
- Quick switching via tabs
- Split within tab panel

#### 10. Output Buffer Management
**Current**: Fixed 10,000 line / 5MB limit

**To implement**:
- Configurable buffer size per terminal
- "Export output" button to download logs
- Clear buffer command
- Infinite scroll with virtualization

### Low Priority (Future Enhancements)

#### 11. Terminal Profiles
Save and reuse terminal configurations:
- Shell + arguments
- Initial directory
- Environment variables
- Startup commands

#### 12. Broadcast Input
Type in multiple terminals simultaneously:
- Select terminals to broadcast to
- Useful for cluster management

#### 13. Terminal Recording/Playback
Record terminal sessions for documentation or debugging:
- Save session with timestamps
- Playback at variable speed
- Export as video/gif

#### 14. Performance Optimizations
- WebGL renderer for high-throughput output
- Output throttling for builds/logs
- Lazy loading of terminal history

---

## Architecture Notes

### Key Files

| File | Purpose |
|------|---------|
| `packages/server/src/services/terminal-manager.ts` | PTY lifecycle management |
| `packages/server/src/services/terminal-tool.ts` | Agent-facing terminal operations |
| `packages/server/src/server.ts` | REST API routes (search for `/api/terminals`) |
| `packages/ui/src/components/terminal/TerminalWidget.tsx` | xterm.js UI component |
| `packages/ui/src/stores/workspace.ts` | Terminal state and layout integration |
| `packages/contracts/src/terminal.ts` | Shared types and message definitions |

### Data Flow

```
User Input → TerminalWidget → WebSocket → Server → node-pty → Shell
                  ↑                                    ↓
              xterm.js ← WebSocket ← Server ← node-pty output
```

### WebSocket Messages

**Client → Server**:
- `terminal:attach` - Start receiving output
- `terminal:detach` - Stop receiving output
- `terminal:input` - Send keystrokes
- `terminal:resize` - Update dimensions
- `terminal:close` - Terminate process

**Server → Client**:
- `terminal:output` - Shell output data
- `terminal:exit` - Process exited
- `terminal:error` - Error occurred
- `terminal:created` - New terminal created
- `terminal:closed` - Terminal removed

---

## Implementation Priority

If continuing terminal development, suggested order:

1. **Terminal persistence** - Most impactful for usability
2. **Workspace scoping** - Required for multi-project use
3. **Reconnection** - Prevents frustration on network issues
4. **Exit status display** - Quick win, improves UX
5. **Terminal naming** - Quick win, helps organization

---

## Related Documentation

- `docs/TERMINAL-IMPLEMENTATION-PLAN.md` - Original implementation plan
- `packages/contracts/src/terminal.ts` - Type definitions and API contracts
