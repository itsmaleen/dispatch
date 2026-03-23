# Electron Application Architecture Analysis
## Agent Command Center (Merry)

### Project: /Users/marlin/agent-command-center

---

## 1. MAIN ENTRY POINT

**File**: `/Users/marlin/agent-command-center/packages/ui/electron/main.ts`

### Key Information:
- **Architecture Pattern**: T3 Code Pattern (server spawned as child process)
- **Framework**: Electron 41.0.2
- **Entry Point Configuration**: 
  - Source: `packages/ui/electron/main.ts`
  - Compiled to: `packages/ui/dist-electron/main.js`
  - Set in package.json: `"main": "dist-electron/main.js"`

### Development vs Production:
```javascript
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const APP_NAME = isDev ? "Merry (Dev)" : "Merry";
const USER_DATA_DIR = isDev ? "merry-dev" : "merry";
const DEFAULT_SERVER_PORT = isDev ? 3333 : 3334;
```

### State Directory:
```
~/.merry-dev/          (development)
~/.merry/              (production)
```

---

## 2. WINDOW MANAGEMENT

### Window Creation (`createWindow()` function)

**Configuration**:
```javascript
mainWindow = new BrowserWindow({
  title: APP_NAME,
  width: 1400,
  height: 900,
  minWidth: 1000,
  minHeight: 600,
  titleBarStyle: "hiddenInset",           // macOS custom title bar
  trafficLightPosition: { x: 16, y: 16 }, // macOS traffic light position
  webPreferences: {
    nodeIntegration: false,        // Security: disabled
    contextIsolation: true,        // Security: enabled
    preload: path.join(__dirname, "preload.js"),
  },
});
```

### Content Loading:
- **Development**: Loads from Vite dev server (`http://localhost:5173`) with DevTools open
- **Production**: Loads from bundled file (`dist/index.html`)

### Window Lifecycle:
- Single main window created on `app.whenReady()`
- Window persistence: Stored in `mainWindow` variable
- Clean shutdown: Window removed from memory on close
- Single instance enforcement: Only one app instance per dev/prod config

### Server URL Communication:
```javascript
// Set env vars BEFORE creating window
process.env.ACC_SERVER_API_URL = apiUrl;
process.env.ACC_SERVER_WS_URL = wsUrl;

// Send to renderer via IPC after load
mainWindow.webContents.on("did-finish-load", () => {
  mainWindow?.webContents.send("server-info", { 
    port: serverPort,
    apiUrl,
    wsUrl,
  });
});
```

---

## 3. SERVER LIFECYCLE MANAGEMENT

### Server Process Management

The app manages a Node.js server process as a child:

**Port Reservation**:
- Reserves port BEFORE spawning server
- Pattern: Bind to port, get assigned port, close, then spawn
- Fallback ports: 3333 (dev) / 3334 (prod), then +1, +2, etc.

**Server Entry Point Resolution**:
```javascript
// Production (packaged)
/path/to/Resources/server/dist/run.js

// Development
../../server/dist/run.js
```

**Process Spawning**:
```javascript
const child = spawn(process.execPath, [serverEntry], {
  cwd: serverCwd,
  env: { ...buildServerEnv(), ELECTRON_RUN_AS_NODE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
```

### Server Environment Variables:
```
ACC_MODE=desktop
ACC_SERVER_PORT={dynamicPort}
ACC_AUTH_TOKEN={sessionToken}
ACC_STATE_DIR=~/.merry(-dev)/
ACC_NO_BROWSER=1
NODE_ENV=development|production
FORCE_COLOR=0
PATH={augmented with tool paths}
```

### Restart Strategy:
- Max restart attempts: 5
- Backoff: Exponential (1s → 30s max)
- Startup timeout: 15 seconds
- Health check: `GET /health` endpoint

### Logging:
- Log directory: `~/.merry(-dev)/logs/`
- Files: `main.log`, `server.log`
- Server output: Piped to logs, printed to console in dev mode

---

## 4. FOLDER/WORKSPACE MANAGEMENT

### Folder Selection Dialog

**IPC Handler** (main.ts):
```javascript
ipcMain.handle("dialog:openFolder", async (_event, defaultPath?: string) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
    title: "Select Project Folder",
    defaultPath: defaultPath || undefined,
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});
```

### Renderer-Side Usage

**Preload Bridge** (preload.ts):
```javascript
openFolder: (defaultPath?: string) => 
  ipcRenderer.invoke("dialog:openFolder", defaultPath)
```

**In App.tsx**:
```javascript
const handleSwitchProject = async () => {
  if (window.electronAPI?.openFolder) {
    const path = await window.electronAPI.openFolder();
    if (path) {
      const name = path.split("/").pop() || path;
      setProject({ path, name, lastOpened: Date.now() });
    }
  }
};
```

**In Workspace.tsx** (line 3813):
```javascript
if (window.electronAPI?.openFolder) {
  const path = await window.electronAPI.openFolder(workspacePath || undefined);
  if (path) {
    // Handle path update
  }
}
```

### Workspace State Management

**Zustand Store** (`stores/workspace.ts`):
```typescript
interface WorkspaceState {
  workspacePath: string | null;
  agents: WorkspaceAgent[];
  consoles: ConsoleInfo[];
  realTerminals: RealTerminalInfo[];
  planSteps: PlanStep[];
  
  // Layout management
  layoutTree: LayoutNode | null;
  focusedWidgetId: string | null;
  focusedWidgetType: WidgetType | null;
  maximizedWidgetId: string | null;
  
  // Callbacks
  onCreateConsole: ((agentId: string, options?: ConsoleResumeOptions) => void) | null;
  onCreateTerminal: ((cwd?: string) => void) | null;
  onCreateTask: ((text: string, agentId: string | null) => void) | null;
}
```

**Project Storage** (`stores/app.ts`):
```typescript
interface Project {
  path: string;
  name: string;
  lastOpened: number;
}

// Persisted via Zustand middleware
const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentProject: null,
      recentProjects: [],
      // ...
    }),
    {
      name: 'acc-storage',
      partialize: (state) => ({
        recentProjects: state.recentProjects,
        widgetLayouts: state.widgetLayouts,
      }),
    }
  )
);
```

### Recent Projects Tracking:
- Stored in localStorage via Zustand persist
- Updated on project selection
- Limited to 10 most recent projects
- Includes `lastOpened` timestamp

---

## 5. IPC (Inter-Process Communication)

### IPC Patterns

#### Sync IPC (preload.ts line 20):
```javascript
try {
  const info = ipcRenderer.sendSync("server:get-urls");
  if (info && typeof info === 'object') {
    serverApiUrl = info.apiUrl || "";
    serverWsUrl = info.wsUrl || "";
    serverPort = parseInt(new URL(serverApiUrl).port) || 0;
  }
} catch (e) {
  console.warn("[preload] Failed to get server URLs via IPC:", e);
}
```

#### Async IPC (handlers):
All handlers use `ipcMain.handle()` for async operations

### IPC Channel Registry

**Server Channels**:
1. `server:get-urls` (sync) - Get current server URLs
2. `server:info` (async handle) - Get server info with PID
3. `server:restart` (async handle) - Manually restart server

**Adapter Channels**:
1. `adapter:connect` - Connect to adapter
2. `adapter:disconnect` - Disconnect adapter
3. `adapter:send` - Send message to adapter

**Launcher Channels**:
1. `launcher:cursor` - Open project in Cursor editor
2. `launcher:browser` - Open URL in default browser

**Tool Channels**:
1. `coderabbit:review` - Run CodeRabbit review
2. `github:createPr` - Create GitHub PR

**File Dialog Channels**:
1. `dialog:openFolder` - Show folder selection dialog

### Preload API Exposure

**contextBridge.exposeInMainWorld("electronAPI", {** structure:
```javascript
server: {
  getInfo(),
  getPort(),
  getApiUrl(),
  getWsUrl(),
  onInfo(callback),  // Listen to server-info events
}

adapter: {
  connect(adapterId, config),
  disconnect(adapterId),
  send(adapterId, message),
  onEvent(callback),
}

launcher: {
  cursor(path),
  browser(url),
}

coderabbit: {
  review(cwd),
}

github: {
  createPr(options),
}

platform: NodeJS.Platform,

openFolder(defaultPath?: string),
```

---

## 6. WINDOW CONFIGURATION

### BrowserWindow Configuration

**Dimensions**:
- Default: 1400×900 pixels
- Minimum: 1000×600 pixels
- Responsive: No maximum constraints

**Platform-Specific**:
- macOS: Hidden title bar with traffic lights at (16, 16)
- Other: Default title bar

**Security**:
- Node integration: Disabled
- Context isolation: Enabled
- Sandbox: Enabled (default)
- Preload script: Signed and verified

**Development Features**:
- DevTools: Opened automatically in dev mode
- Hot reload: Via Vite dev server connection

### Multi-Window Support

Currently: **Single main window model**
- Only `mainWindow` variable tracked
- On second instance, existing window is focused/restored
- No support for multiple top-level windows (can be added)

---

## 7. PACKAGE.JSON AND DEPENDENCIES

**Location**: `/Users/marlin/agent-command-center/packages/ui/package.json`

### Key Scripts:
```json
{
  "dev": "bun run --parallel dev:vite dev:electron",
  "dev:vite": "vite",
  "dev:electron": "bun run scripts/dev-electron.mjs",
  "build": "vite build && bunx tsc -p tsconfig.electron.json && ... && bun run build:electron",
  "build:electron": "CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder",
  "start": "electron .",
  "rebuild": "npx @electron/rebuild"
}
```

### Critical Dependencies:
```json
{
  "electron": "^40.0.0",           // (41.0.2 in root package.json)
  "electron-builder": "^25.0.0",
  "node-pty": "1.1.0",             // Terminal support
  "react": "^19.0.0",
  "zustand": "^5.0.11",            // State management
  "react-resizable-panels": "^2.1.0",
  "@dnd-kit/core": "^6.3.1",      // Drag & drop
  "xterm": "^5.3.0",               // Terminal UI
  "@xterm/addon-*": "^*"
}
```

### Build Configuration:
```json
{
  "build": {
    "appId": "com.merry.app",
    "productName": "Merry",
    "files": ["dist/**/*", "dist-electron/**/*"],
    "extraResources": [{
      "from": "server-bundle",
      "to": "server"
    }],
    "mac": {
      "target": ["dmg", "zip"],
      "hardenedRuntime": true,
      "notarize": true
    },
    "win": { "target": ["nsis", "zip"] },
    "linux": { "target": ["AppImage", "deb"] }
  }
}
```

---

## 8. LAYOUT AND WIDGET MANAGEMENT

### Layout System (tmux-style nested panels)

**Layout Types**:
- `LayoutLeaf`: Single widget (agent-console, terminal, tasks, agent-status)
- `LayoutGroup`: Split container with direction (horizontal/vertical) and children

**Layout Presets**:
1. **default**: Content widgets left (vertical), utility widgets right
2. **master-stack**: First widget 65% left, rest 35% stacked on right
3. **even-horizontal**: All widgets side-by-side
4. **even-vertical**: All widgets stacked vertically
5. **quad**: 2×2 grid layout

**Widget Types**:
```typescript
type WidgetType = 'agent-console' | 'tasks' | 'agent-status' | 'terminal';
```

**Layout Persistence**:
- Storage key: `'workspace-layout-v1'` (localStorage)
- Auto-save available via `useWorkspaceStore.getState().saveLayout()`
- Restore: `restoreLayout()` function

### Layout Tree Operations:
- `splitPanel(panelId, direction, newWidgetId)`
- `addPanelToLayout(options)`
- `closePanelInLayout(panelId)`
- `swapPanels(panelId1, panelId2)`
- `movePanel(sourcePanelId, targetPanelId, position)`
- `updatePanelSizes(groupId, sizes)`
- `applyLayoutPreset(preset, widgets)`

---

## 9. KEY ARCHITECTURAL DECISIONS

### T3 Code Pattern
- Server lifecycle fully managed by Electron
- Server runs as child process, not external
- Works identically in dev and production
- No checking for existing server instances

### Security Model
- `contextIsolation: true` - Renderer can't access Node APIs directly
- Preload script bridges main and renderer
- Only specific APIs exposed via `electronAPI`
- IPC validation at every handler

### State Management
- **Main state**: Zustand stores in renderer
- **Server communication**: REST API + WebSocket
- **Persistence**: localStorage for projects/layouts
- **Real-time**: WebSocket for streaming updates

### File System Access
- Only folder selection exposed to renderer
- Path validation done in main process
- Server handles actual file operations

### Development Workflow
- Vite dev server for hot reload (renderer)
- TypeScript compilation for main/preload
- Separate dev/prod identities (prevents conflicts)
- Automatic server spawning on app start

---

## 10. STARTUP SEQUENCE

1. **App Initialization** (`app.whenReady()`)
   - Set app name and user data path
   - Request single instance lock
   
2. **Bootstrap** (`bootstrap()` function)
   - Reserve available port
   - Generate session auth token
   - Spawn server process
   - Wait for server health check (15s timeout)
   - Create main window

3. **Window Setup** (`createWindow()`)
   - Set server URLs in env vars
   - Create BrowserWindow with preload
   - Load content (Vite dev or bundled)

4. **Preload Initialization**
   - Get server URLs via sync IPC
   - Fallback to env vars
   - Listen for server-info updates

5. **Renderer Initialization** (React app)
   - Discover server port (browser dev)
   - Initialize stores
   - Register callbacks
   - Start application

---

## 11. CURRENT WINDOW MODEL

### Single Window Pattern
- **mainWindow**: Global variable holding BrowserWindow instance
- **Lifecycle**: Created on app ready, destroyed on close
- **Single Instance**: `app.requestSingleInstanceLock()`
- **Second Instance Behavior**: Focus and restore existing window

### Activation/Restore
```javascript
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    bootstrap();
  }
});
```

### Graceful Shutdown
```javascript
app.on("before-quit", () => {
  isQuitting = true;
  stopServer();  // SIGTERM then SIGKILL if needed
});
```

---

## 12. FILE STRUCTURE

```
packages/ui/
├── electron/
│   ├── main.ts           (Main process entry point)
│   └── preload.ts        (Context bridge API)
├── src/
│   ├── App.tsx           (Root React component)
│   ├── main.tsx          (React mount point)
│   ├── types/
│   │   └── electron.d.ts (TypeScript definitions for electronAPI)
│   ├── stores/
│   │   ├── app.ts        (Global app state)
│   │   ├── workspace.ts  (Workspace/layout state)
│   │   └── command-palette.ts
│   ├── components/
│   │   ├── workspace/
│   │   │   ├── Workspace.tsx
│   │   │   ├── ProjectStartingPoint.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   ├── TasksWidget.tsx
│   │   │   └── WorktreePanel.tsx
│   │   ├── home/
│   │   │   └── HomePage.tsx
│   │   ├── terminal/
│   │   │   └── TerminalWidget.tsx
│   │   └── command-palette/
│   └── hooks/
├── dist/                 (Bundled renderer)
├── dist-electron/        (Compiled main/preload)
└── package.json
```

---

## SUMMARY

This is a modern Electron application following best practices:

✓ **Security**: Context isolation, preload sandboxing, no node integration
✓ **Architecture**: T3 pattern with managed server lifecycle
✓ **State Management**: Zustand with persistence
✓ **Multi-Platform**: Built for macOS, Windows, Linux
✓ **Development**: Hot reload, separate dev/prod environments
✓ **Scalability**: Layout system supports flexible window arrangements
✓ **Communication**: REST API + WebSocket with Electron IPC bridge

