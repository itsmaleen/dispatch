# Electron Architecture Documentation Index

This documentation provides a comprehensive exploration of the Agent Command Center (Dispatch) Electron application's window and folder management system.

## Documentation Files

### 1. **ELECTRON_ARCHITECTURE.md** - Comprehensive Analysis
**Best for:** Deep understanding of the system architecture

The complete technical breakdown covering:
- **Main Entry Point** - Electron 41.0.2 setup with T3 Code Pattern
- **Window Management** - Single window model with macOS customizations
- **Server Lifecycle** - Port reservation, spawning, health checks, restart strategy
- **Folder Management** - Native dialog integration with Zustand state management
- **IPC Communication** - All channels and patterns for main/renderer communication
- **Window Configuration** - BrowserWindow options, security settings, content loading
- **Package.json** - Dependencies and build configuration
- **Layout System** - tmux-style nested panels with persistence
- **Architectural Decisions** - Why things are built this way
- **File Structure** - Complete project layout

**Quick Access:**
- Want to understand how windows are created? See section 2
- Want to know how folder selection works? See section 4
- Want IPC channel list? See section 5
- Want to understand state management? See section 4 (workspace) and 7 (package)

### 2. **ARCHITECTURE_DIAGRAM.md** - Visual System Overview
**Best for:** Visual learners and system flow understanding

Contains ASCII diagrams showing:
- **System Overview** - Main process, preload, renderer, server relationships
- **Window Creation Flow** - Step-by-step from app.whenReady() to React initialization
- **Folder Selection Flow** - Complete user interaction → IPC → state update flow
- **Layout Tree Structure** - How the panel system is organized
- **Server Lifecycle** - Process spawning, health checks, restart backoff
- **IPC Channel Map** - Visual hierarchy of all communication channels
- **Security Boundaries** - Sandbox and context isolation model
- **Storage Locations** - Where logs and state are persisted

**Use Case Examples:**
- "Show me how the app starts" → Window Creation Flow
- "How does folder selection work?" → Folder Selection Flow
- "What are all the IPC channels?" → IPC Channel Map
- "How is security enforced?" → Security Boundaries

### 3. **ELECTRON_QUICK_REFERENCE.md** - Quick Lookup Guide
**Best for:** Active development and troubleshooting

Organized quick references including:
- **File Locations Table** - Where to find what (one-page)
- **Key Commands** - All npm scripts for dev/build
- **Main Process Entry Points** - App lifecycle functions and global variables
- **IPC Channels** - Quick list of all handlers
- **Window Configuration** - Copy-paste configuration options
- **Server Management Functions** - Function signatures and purposes
- **Environment Variables** - What the app sets and where
- **Preload Script API** - Full API interface
- **Common Patterns** - Code snippets for frequent tasks
- **Troubleshooting** - Common issues and solutions

**Quick Navigation:**
- Need to add an IPC handler? See "IPC Channels (Main → Renderer)" section
- How do I select a folder? See "Common Patterns" section
- Where's the server config? See "Environment Variables Set by Main" section
- App won't run? See "Troubleshooting" section

## How to Use This Documentation

### For Understanding the System (First Time)
1. Start with **ARCHITECTURE_DIAGRAM.md** "System Overview"
2. Read **ELECTRON_ARCHITECTURE.md** sections 1-2 (Entry Point, Window Management)
3. Review **ELECTRON_ARCHITECTURE.md** section 4 (Folder Management)
4. Reference **ARCHITECTURE_DIAGRAM.md** "Folder Selection Flow"

### For Implementation (Adding Features)
1. Identify what you're building using **DOCUMENTATION_INDEX.md** (this file)
2. Find the relevant section in **ELECTRON_ARCHITECTURE.md**
3. Use **ELECTRON_QUICK_REFERENCE.md** for code snippets
4. Reference **ARCHITECTURE_DIAGRAM.md** flows if you need to understand interactions

### For Debugging (Something's Wrong)
1. Check **ELECTRON_QUICK_REFERENCE.md** "Troubleshooting" section
2. Look at log locations and what might be wrong
3. Reference **ARCHITECTURE_DIAGRAM.md** flows to understand where the problem occurs
4. Check **ELECTRON_QUICK_REFERENCE.md** "Common Patterns" for working examples

## Key Concepts Quick Reference

### Main Components
- **Main Process** (main.ts) - Electron app lifecycle, window management, server, IPC
- **Preload Script** (preload.ts) - Security bridge exposing electronAPI
- **Renderer Process** (App.tsx, Workspace.tsx) - React UI, state management
- **Backend Server** - Node.js child process on port 3333/3334

### Core Concepts
- **T3 Code Pattern** - Server lifecycle fully managed by Electron
- **Window Model** - Single main window, single instance lock per dev/prod
- **IPC** - Message-based communication between main and renderer
- **State Management** - Zustand stores with localStorage persistence
- **Layout System** - Nested leaf/group tree (tmux-style)
- **Folder Management** - Native dialog → IPC → Zustand state

### Important Paths
- Project root: `/Users/marlin/agent-command-center/`
- Main process: `packages/ui/electron/main.ts`
- Renderer: `packages/ui/src/App.tsx`
- State stores: `packages/ui/src/stores/`
- Components: `packages/ui/src/components/`

### Important Ports
- Development: 3333 (server), 5173 (Vite)
- Production: 3334 (server)
- Both have fallback ports (3334+, 3335+, etc.)

## Document Statistics

| Document | Lines | Size | Purpose |
|----------|-------|------|---------|
| ELECTRON_ARCHITECTURE.md | 596 | 15KB | Detailed technical analysis |
| ARCHITECTURE_DIAGRAM.md | 385 | 21KB | Visual system diagrams |
| ELECTRON_QUICK_REFERENCE.md | 384 | 11KB | Quick lookup reference |
| **Total** | **1,365** | **47KB** | Complete documentation |

## File Dependencies

```
ARCHITECTURE_DIAGRAM.md (visual reference)
    ↓ references
ELECTRON_ARCHITECTURE.md (detailed specs)
    ↓ cross-references
ELECTRON_QUICK_REFERENCE.md (quick lookup)
    ↑ all point back to
Key Source Files:
    • packages/ui/electron/main.ts
    • packages/ui/electron/preload.ts
    • packages/ui/src/stores/app.ts
    • packages/ui/src/stores/workspace.ts
    • packages/ui/src/App.tsx
    • packages/ui/src/components/workspace/Workspace.tsx
```

## Common Tasks and Where to Find Info

### Task: Add a New IPC Channel
1. Read: ELECTRON_ARCHITECTURE.md section 5 (IPC)
2. Reference: ELECTRON_QUICK_REFERENCE.md "IPC Channels" section
3. Edit: `packages/ui/electron/main.ts` (add handler)
4. Edit: `packages/ui/electron/preload.ts` (expose via contextBridge)
5. Edit: `packages/ui/src/types/electron.d.ts` (update types)

### Task: Modify Window Size/Behavior
1. Read: ELECTRON_ARCHITECTURE.md section 2 (Window Management)
2. Reference: ELECTRON_QUICK_REFERENCE.md "Window Configuration" section
3. Edit: `packages/ui/electron/main.ts` (createWindow function)
4. See: ARCHITECTURE_DIAGRAM.md "System Overview" for context

### Task: Add Folder Selection Functionality
1. Read: ELECTRON_ARCHITECTURE.md section 4 (Folder Management)
2. Study: ARCHITECTURE_DIAGRAM.md "Folder Selection Flow"
3. Reference: ELECTRON_QUICK_REFERENCE.md "Common Patterns"
4. Component: Use `window.electronAPI.openFolder()` in React

### Task: Understand Layout System
1. Read: ELECTRON_ARCHITECTURE.md section 8 (Layout System)
2. Study: ARCHITECTURE_DIAGRAM.md "Layout Tree Structure"
3. Reference: ELECTRON_QUICK_REFERENCE.md "Workspace Store Key Actions"
4. Edit: `packages/ui/src/stores/workspace.ts` if needed

### Task: Debug Server Issues
1. Check: ELECTRON_QUICK_REFERENCE.md "Troubleshooting" section
2. Review: ARCHITECTURE_DIAGRAM.md "Server Lifecycle"
3. Read: ELECTRON_ARCHITECTURE.md section 3 (Server Lifecycle)
4. Logs: ~/.dispatch(-dev)/logs/{main,server}.log

### Task: Understand IPC Communication
1. Study: ARCHITECTURE_DIAGRAM.md "IPC Channel Map"
2. Read: ELECTRON_ARCHITECTURE.md section 5 (IPC)
3. Reference: ELECTRON_QUICK_REFERENCE.md "Preload Script API"
4. See: ARCHITECTURE_DIAGRAM.md "Security Boundaries"

## Navigation Tips

### Reading Order by Use Case

**Learning the System:**
1. ARCHITECTURE_DIAGRAM.md - System Overview
2. ELECTRON_ARCHITECTURE.md - Sections 1-3
3. ARCHITECTURE_DIAGRAM.md - Window Creation Flow
4. ELECTRON_ARCHITECTURE.md - Section 9 (Architecture Decisions)

**Building a Feature:**
1. ELECTRON_QUICK_REFERENCE.md - Find your task in the table
2. ELECTRON_ARCHITECTURE.md - Read referenced section
3. ARCHITECTURE_DIAGRAM.md - Understand the flow
4. ELECTRON_QUICK_REFERENCE.md - Copy code patterns

**Fixing a Bug:**
1. ELECTRON_QUICK_REFERENCE.md - Troubleshooting
2. ELECTRON_ARCHITECTURE.md - Problem area
3. ARCHITECTURE_DIAGRAM.md - Flow diagrams
4. Check logs and code references

**Understanding Security:**
1. ARCHITECTURE_DIAGRAM.md - Security Boundaries
2. ELECTRON_ARCHITECTURE.md - Section 6 (Window Configuration)
3. ELECTRON_QUICK_REFERENCE.md - Window Configuration section

## Cross-References

### Windows and Folder Management
- ELECTRON_ARCHITECTURE.md sections 2 and 4
- ARCHITECTURE_DIAGRAM.md "Window Creation Flow" and "Folder Selection Flow"
- ELECTRON_QUICK_REFERENCE.md "Window Configuration" and "Common Patterns"

### State and IPC
- ELECTRON_ARCHITECTURE.md sections 4 and 5
- ARCHITECTURE_DIAGRAM.md "IPC Channel Map" and "Folder Selection Flow"
- ELECTRON_QUICK_REFERENCE.md "IPC Channels" and "Renderer-Side Integration"

### Server and Window Initialization
- ELECTRON_ARCHITECTURE.md sections 2 and 3
- ARCHITECTURE_DIAGRAM.md "Window Creation Flow"
- ELECTRON_QUICK_REFERENCE.md "Server Management Functions"

## Getting Help

**If you need to understand...**
- HOW the app starts → ARCHITECTURE_DIAGRAM.md "Window Creation Flow"
- HOW folders are selected → ARCHITECTURE_DIAGRAM.md "Folder Selection Flow"
- HOW IPC works → ARCHITECTURE_DIAGRAM.md "IPC Channel Map"
- HOW the server works → ARCHITECTURE_DIAGRAM.md "Server Lifecycle"
- WHERE files are → ELECTRON_QUICK_REFERENCE.md "File Locations"
- WHAT to edit → ELECTRON_QUICK_REFERENCE.md "Key Files to Edit"
- HOW to code something → ELECTRON_QUICK_REFERENCE.md "Common Patterns"
- WHY it's designed this way → ELECTRON_ARCHITECTURE.md "Architectural Decisions"

---

**Last Updated:** March 22, 2026
**Documentation Version:** 1.0
**Electron Version:** 41.0.2
**React Version:** 19.0.0
