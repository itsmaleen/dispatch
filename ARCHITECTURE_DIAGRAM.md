# Electron Application Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     DISPATCH ELECTRON APP                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  MAIN PROCESS (main.ts)                         │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  • App Lifecycle (app.whenReady, app.on('activate'))           │
│  • Window Management (mainWindow: BrowserWindow)                │
│  • Server Process Management                                    │
│  • Port Reservation (3333/3334 + fallback)                      │
│  • IPC Handlers                                                 │
│  • File Dialogs                                                 │
│  • Logging                                                      │
│                                                                  │
│  Global State:                                                  │
│  ├─ mainWindow: BrowserWindow | null                           │
│  ├─ serverProcess: ChildProcess | null                         │
│  ├─ serverPort: number                                         │
│  ├─ serverAuthToken: string                                    │
│  ├─ restartAttempt: number                                     │
│  └─ isQuitting: boolean                                        │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                              │ IPC
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              PRELOAD SCRIPT (preload.ts)                        │
│  ─────────────────────────────────────────────────────────────  │
│  Bridges main and renderer via contextBridge                    │
│                                                                  │
│  window.electronAPI = {                                         │
│    server: {                                                    │
│      getInfo(), getPort(), getApiUrl(), getWsUrl(),          │
│      onInfo(callback)                                          │
│    },                                                           │
│    adapter: { connect, disconnect, send, onEvent },           │
│    launcher: { cursor, browser },                             │
│    coderabbit: { review },                                    │
│    github: { createPr },                                      │
│    platform: NodeJS.Platform,                                 │
│    openFolder(defaultPath?)                                   │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                          Sandbox Boundary
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│            RENDERER PROCESS (React App in BrowserWindow)        │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  App.tsx (Root Component)                               │   │
│  │  ├─ Handles global keyboard shortcuts                  │   │
│  │  ├─ Manages view routing (home/workspace/planning)     │   │
│  │  └─ Initializes stores                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↓                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Workspace.tsx                                          │   │
│  │  ├─ Main workspace layout management                   │   │
│  │  ├─ Agent consoles (WebSocket-based)                   │   │
│  │  ├─ Layout system (tmux-style panels)                  │   │
│  │  ├─ Tasks widget                                       │   │
│  │  ├─ Terminal widget (node-pty)                         │   │
│  │  └─ ProjectStartingPoint                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↓                                  │
│  ┌──────────────────┐  ┌──────────────────────────────────┐   │
│  │  Zustand Stores  │  │  WebSocket/API Communication     │   │
│  ├──────────────────┤  ├──────────────────────────────────┤   │
│  │ useAppStore      │  │ REST API (getServerUrl())        │   │
│  │ ├─ currentProject│──│ ├─ /health                       │   │
│  │ ├─ agents        │  │ ├─ /sessions                     │   │
│  │ ├─ tasks         │  │ ├─ /threads                      │   │
│  │ └─ recentProjects│  │ └─ /agents                       │   │
│  │                  │  │                                  │   │
│  │ useWorkspaceStore│  │ WebSocket (getWsUrl())           │   │
│  │ ├─ workspacePath │  │ └─ ws://localhost:{port}/events  │   │
│  │ ├─ agents        │  │    (streaming updates)           │   │
│  │ ├─ consoles      │  │                                  │   │
│  │ ├─ layoutTree    │  └──────────────────────────────────┘   │
│  │ └─ focusedWidget │                                     │   │
│  │                  │                                     │   │
│  │ localStorage     │                                     │   │
│  │ └─ projects,     │                                     │   │
│  │    layout state  │                                     │   │
│  └──────────────────┘                                     │   │
│                                                           │   │
└───────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│           BACKEND SERVER (Node.js Child Process)                │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  Port: 3333 (dev) / 3334 (prod)                                 │
│  Spawned by main.ts via spawn(process.execPath, [...])         │
│                                                                  │
│  Environment:                                                   │
│  ├─ ACC_MODE=desktop                                           │
│  ├─ ACC_SERVER_PORT={dynamicPort}                              │
│  ├─ ACC_AUTH_TOKEN={sessionToken}                              │
│  ├─ ACC_STATE_DIR=~/.dispatch(-dev)/                           │
│  ├─ ELECTRON_RUN_AS_NODE=1                                     │
│  └─ PATH={augmented with tools}                                │
│                                                                  │
│  Processes:                                                     │
│  ├─ HTTP Server (REST API)                                     │
│  ├─ WebSocket Server (streaming)                               │
│  ├─ Session Management                                         │
│  ├─ Thread Management                                          │
│  └─ Adapter Communication                                      │
│                                                                  │
│  Logging: ~/.dispatch(-dev)/logs/                              │
│  ├─ main.log                                                   │
│  └─ server.log                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Window Creation Flow

```
┌──────────────┐
│ app.whenReady │
└──────────────┘
       ↓
┌───────────────────────────────┐
│ app.requestSingleInstanceLock │
│ (separate for dev/prod)        │
└───────────────────────────────┘
       ↓
┌────────────────────────┐
│ bootstrap()            │
├────────────────────────┤
│ • Reserve port         │
│ • Generate auth token  │
│ • Spawn server process │
│ • Wait health check    │
│ • Create window        │
└────────────────────────┘
       ↓
┌────────────────────────────────┐
│ createWindow()                 │
├────────────────────────────────┤
│ new BrowserWindow({            │
│   width: 1400,                 │
│   height: 900,                 │
│   minWidth: 1000,              │
│   minHeight: 600,              │
│   contextIsolation: true,      │
│   preload: "preload.js"        │
│ })                             │
└────────────────────────────────┘
       ↓
┌────────────────────────────────┐
│ Dev: Load from Vite            │
│ http://localhost:5173          │
│                                │
│ Prod: Load bundled HTML        │
│ file:///dist/index.html        │
└────────────────────────────────┘
       ↓
┌────────────────────────────────┐
│ did-finish-load event          │
│ Send server-info via IPC       │
└────────────────────────────────┘
       ↓
┌────────────────────────────────┐
│ React App Initializes          │
│ Discover server port           │
│ Initialize stores              │
└────────────────────────────────┘
```

## Folder Selection Flow

```
User Action (HomePage, Workspace header)
         ↓
window.electronAPI.openFolder(defaultPath?)
         ↓
IPC: ipcRenderer.invoke("dialog:openFolder", defaultPath)
         ↓
Main Process Handler
├─ dialog.showOpenDialog(mainWindow!, {
│   properties: ["openDirectory"],
│   title: "Select Project Folder",
│   defaultPath: defaultPath || undefined
│ })
         ↓
Native File Dialog
         ↓
User selects folder
         ↓
Returns: { canceled, filePaths[0] }
         ↓
IPC Reply: folderPath or null
         ↓
Renderer: 
├─ useAppStore.setProject({
│   path: folderPath,
│   name: folderName,
│   lastOpened: Date.now()
│ })
├─ useWorkspaceStore.setWorkspacePath(folderPath)
└─ localStorage persists recentProjects
```

## Layout Tree Structure

```
Root Layout Node
│
├─ LayoutLeaf
│  └─ widgetType: 'agent-console' | 'terminal' | 'tasks' | 'agent-status'
│
├─ LayoutGroup (horizontal/vertical)
│  ├─ children: [LayoutNode, LayoutNode, ...]
│  └─ sizes: [50, 50]
│     (percentages summing to 100)
│
└─ LayoutGroup (horizontal)
   ├─ children: [
   │    LayoutGroup (vertical) - left panel
   │    │  └─ children: [agent-console, agent-console]
   │    LayoutGroup (vertical) - right panel
   │       └─ children: [agent-status, tasks]
   │  ]
   └─ sizes: [60, 40]

Preset Layouts:
├─ default: left content (vertical) + right utility
├─ master-stack: first widget 65% left + rest 35% right stacked
├─ even-horizontal: all widgets side-by-side
├─ even-vertical: all widgets stacked vertically
└─ quad: 2x2 grid (4 widgets max)

Persistence:
└─ localStorage['workspace-layout-v1'] = JSON.stringify(layoutTree)
```

## Server Lifecycle

```
┌─────────────────────────┐
│ Start Server Process    │
│ spawn(process.execPath) │
└─────────────────────────┘
           ↓
┌─────────────────────────┐
│ Server Spawned Event    │
│ Reset restartAttempt=0  │
└─────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│ Health Check Poll (every 200ms)     │
│ GET http://127.0.0.1:{port}/health │
└─────────────────────────────────────┘
           ↓
    ┌──────────────┬──────────────┐
    ↓              ↓
Server OK      Timeout (15s)
    ↓              ↓
Ready      ┌─────────────────┐
           │ Server Failed   │
           │ scheduleRestart │
           └─────────────────┘
                  ↓
           ┌──────────────────────┐
           │ Exponential Backoff   │
           │ 1s → 2s → 4s → 8s... │
           │ max 30s              │
           │ max 5 attempts       │
           └──────────────────────┘
                  ↓
         ┌────────────────────┐
         │ Restart Server     │
         │ restartAttempt++   │
         └────────────────────┘
```

## IPC Channel Map

```
Main Process (ipcMain handlers)
│
├─ SERVER CHANNELS
│  ├─ "server:get-urls" → sendSync → { apiUrl, wsUrl }
│  ├─ "server:info" → handle → { port, pid, apiUrl, wsUrl }
│  └─ "server:restart" → handle → boolean
│
├─ ADAPTER CHANNELS
│  ├─ "adapter:connect" → handle
│  ├─ "adapter:disconnect" → handle
│  └─ "adapter:send" → handle
│
├─ LAUNCHER CHANNELS
│  ├─ "launcher:cursor" → handle (exec "cursor {path}")
│  └─ "launcher:browser" → handle (shell.openExternal)
│
├─ TOOL CHANNELS
│  ├─ "coderabbit:review" → handle
│  └─ "github:createPr" → handle
│
├─ DIALOG CHANNELS
│  └─ "dialog:openFolder" → handle → folderPath | null
│
└─ EVENT CHANNELS (push notifications)
   ├─ "server-info" ← main sends to renderer
   └─ "adapter:event" ← main sends to renderer

Preload Bridge
│
└─ window.electronAPI
   ├─ server.*
   ├─ adapter.*
   ├─ launcher.*
   ├─ coderabbit.*
   ├─ github.*
   ├─ platform
   └─ openFolder()
```

## Security Boundaries

```
┌──────────────────────────────────────────────────────────┐
│ Main Process                                             │
│ ├─ Full Node.js access                                 │
│ ├─ File system (read/write anywhere)                   │
│ ├─ Process management                                  │
│ └─ System dialogs                                      │
└──────────────────────────────────────────────────────────┘
           ↑
           │ IPC (message-based, type-safe)
           ↓
┌──────────────────────────────────────────────────────────┐
│ Preload Script (context isolation)                      │
│ ├─ Controlled API surface only                         │
│ ├─ Whitelisted handlers only                           │
│ ├─ contextBridge prevents direct access                │
│ └─ Type definitions in window.d.ts                     │
└──────────────────────────────────────────────────────────┘
           ↑
           │ sandbox boundary
           ↓
┌──────────────────────────────────────────────────────────┐
│ Renderer Process (Sandbox)                              │
│ ├─ No direct Node.js access                           │
│ ├─ No direct file system access                       │
│ ├─ Limited to electronAPI via preload                 │
│ ├─ REST API for server communication                  │
│ └─ localStorage for persistence                       │
└──────────────────────────────────────────────────────────┘
```

## Storage Locations

```
Development (~/.dispatch-dev/)
├─ logs/
│  ├─ main.log
│  └─ server.log
├─ Cache/
└─ Preferences/

Production (~/.dispatch/)
├─ logs/
│  ├─ main.log
│  └─ server.log
├─ Cache/
└─ Preferences/

Renderer State (localStorage)
├─ acc-storage (persisted parts)
│  ├─ recentProjects
│  └─ widgetLayouts
└─ workspace-layout-v1 (current layout)
```
