# Electron App Quick Reference Guide

## File Locations

| Purpose | Location | Type |
|---------|----------|------|
| Main process entry | `packages/ui/electron/main.ts` | TypeScript |
| Preload script | `packages/ui/electron/preload.ts` | TypeScript |
| Root React component | `packages/ui/src/App.tsx` | React/TypeScript |
| Workspace component | `packages/ui/src/components/workspace/Workspace.tsx` | React/TypeScript |
| Global app state | `packages/ui/src/stores/app.ts` | Zustand |
| Workspace state | `packages/ui/src/stores/workspace.ts` | Zustand |
| Electron API types | `packages/ui/src/types/electron.d.ts` | TypeScript definitions |
| Package config | `packages/ui/package.json` | JSON |

## Key Commands

```bash
# Development
npm run dev              # Start dev server + Electron
npm run dev:vite        # Just Vite dev server
npm run dev:electron    # Just Electron dev

# Build
npm run build           # Build everything (vite + electron-builder)
npm run build:electron  # Just build Electron package
npm start               # Run packaged app

# Development utilities
npm run typecheck       # Type check without building
npm run lint            # Lint code
npm run rebuild         # Rebuild native modules
```

## Main Process Entry Points

### App Lifecycle Functions

```javascript
app.whenReady()              // Ready to create windows
app.on('activate')           // App activated (macOS)
app.on('before-quit')        // Quitting
app.on('window-all-closed')  // All windows closed
```

### Global Variables (main.ts scope)

```javascript
let mainWindow: BrowserWindow | null         // Main window instance
let serverProcess: ChildProcess | null       // Server process
let serverPort = 0                           // Current server port
let serverAuthToken = ""                     // Session auth token
let restartAttempt = 0                       // Server restart counter
let restartTimer: ReturnType<...> | null     // Restart timeout
let isQuitting = false                       // Shutdown flag
```

## IPC Channels (Main → Renderer Communication)

### Handlers (async)

```javascript
// Server
ipcMain.handle("server:info", ...)           // { port, pid, apiUrl, wsUrl }
ipcMain.handle("server:restart", ...)        // boolean

// Adapters
ipcMain.handle("adapter:connect", ...)       // { ok: boolean }
ipcMain.handle("adapter:disconnect", ...)    // { ok: boolean }
ipcMain.handle("adapter:send", ...)          // { ok: boolean, turnId }

// Launchers
ipcMain.handle("launcher:cursor", ...)       // { ok: boolean }
ipcMain.handle("launcher:browser", ...)      // { ok: boolean }

// Tools
ipcMain.handle("coderabbit:review", ...)     // { ok, output }
ipcMain.handle("github:createPr", ...)       // { ok, output }

// Dialogs
ipcMain.handle("dialog:openFolder", ...)     // folderPath | null
```

### Sync Handlers

```javascript
ipcMain.on("server:get-urls", (event) => {
  event.returnValue = { apiUrl, wsUrl }
})
```

### Events (Main → Renderer)

```javascript
mainWindow?.webContents.send("server-info", { port, apiUrl, wsUrl })
mainWindow?.webContents.send("adapter:event", ...)
```

## Window Configuration

```javascript
new BrowserWindow({
  title: APP_NAME,           // "Merry" or "Merry (Dev)"
  width: 1400,
  height: 900,
  minWidth: 1000,
  minHeight: 600,
  titleBarStyle: "hiddenInset",           // macOS only
  trafficLightPosition: { x: 16, y: 16 }, // macOS only
  webPreferences: {
    nodeIntegration: false,     // IMPORTANT: Security
    contextIsolation: true,     // IMPORTANT: Security
    preload: path.join(__dirname, "preload.js"),
  },
})
```

## Server Management Functions

### Port Reservation
```javascript
async function reservePort(preferredPort = DEFAULT_SERVER_PORT): Promise<number>
// Binds to port, closes, returns available port
// Fallback: preferredPort, preferredPort+1, preferredPort+2, ...
```

### Server Startup
```javascript
async function startServer(): Promise<boolean>
// 1. Reserves port
// 2. Generates auth token
// 3. Spawns Node.js process with ELECTRON_RUN_AS_NODE=1
// 4. Pipes stdout/stderr to log file
// 5. Polls health endpoint
// 6. Returns success boolean
```

### Server Health Check
```javascript
async function waitForServerReady(port, maxMs = 15000): Promise<boolean>
// Polls GET http://127.0.0.1:{port}/health
// Timeout: 15 seconds by default
// Poll interval: 200ms
```

### Server Restart
```javascript
function scheduleRestart(reason: string): void
// Exponential backoff: 1s → 2s → 4s → 8s → 16s → (max 30s)
// Max 5 restart attempts
// Notifies renderer of port changes via IPC
```

## Environment Variables Set by Main

For the server process:
```
ACC_MODE=desktop
ACC_SERVER_PORT={dynamicPort}
ACC_AUTH_TOKEN={sessionToken}
ACC_STATE_DIR=~/.merry(-dev)/
ACC_NO_BROWSER=1
NODE_ENV=development|production
FORCE_COLOR=0
PATH={augmented with tool paths}
ELECTRON_RUN_AS_NODE=1
```

For the renderer (env vars):
```
ACC_SERVER_API_URL=http://127.0.0.1:{port}
ACC_SERVER_WS_URL=ws://127.0.0.1:{port}
VITE_DEV_SERVER_URL=http://localhost:5173
```

## Preload Script API

Exposed via `window.electronAPI`:

```typescript
interface ElectronAPI {
  server: {
    getInfo(): Promise<{ port: number; pid?: number }>
    getPort(): number
    getApiUrl(): string
    getWsUrl(): string
    onInfo(callback: (info: { port: number }) => void): () => void
  }
  
  adapter: {
    connect(adapterId: string, config: unknown): Promise<{ ok: boolean }>
    disconnect(adapterId: string): Promise<{ ok: boolean }>
    send(adapterId: string, message: string): Promise<{ ok: boolean; turnId: string }>
    onEvent(callback: (event: unknown) => void): () => void
  }
  
  launcher: {
    cursor(path: string): Promise<{ ok: boolean }>
    browser(url: string): Promise<{ ok: boolean }>
  }
  
  coderabbit: {
    review(cwd: string): Promise<{ ok: boolean; output: string }>
  }
  
  github: {
    createPr(options: { title: string; body: string; cwd: string }): Promise<{ ok: boolean; output: string }>
  }
  
  platform: NodeJS.Platform
  
  openFolder(defaultPath?: string): Promise<string | null>
}
```

## Renderer-Side (React) Integration

### Getting Server URLs
```javascript
// In component
const apiUrl = window.electronAPI?.server?.getApiUrl() || 'http://localhost:3333'
const wsUrl = window.electronAPI?.server?.getWsUrl() || 'ws://localhost:3333'
```

### Selecting Folder
```javascript
// In component
const path = await window.electronAPI.openFolder(defaultPath)
useAppStore.getState().setProject({ path, name: path.split('/').pop(), lastOpened: Date.now() })
```

### Listening to Server Info Updates
```javascript
// In useEffect
const unsubscribe = window.electronAPI?.server?.onInfo((info) => {
  console.log('Server info updated:', info)
  // Handle reconnection, etc.
})
return () => unsubscribe?.()
```

## Zustand Store Key Actions

### App Store
```javascript
useAppStore.getState().setProject(project)
useAppStore.getState().addRecentProject(project)
useAppStore.getState().setAgents(agents)
useAppStore.getState().refreshAgentStatus()
```

### Workspace Store
```javascript
useWorkspaceStore.getState().setWorkspacePath(path)
useWorkspaceStore.getState().applyLayoutPreset(preset, widgets)
useWorkspaceStore.getState().splitPanel(panelId, direction, newWidgetId)
useWorkspaceStore.getState().addPanelToLayout({ widgetType, widgetId })
useWorkspaceStore.getState().closePanelInLayout(panelId)
useWorkspaceStore.getState().saveLayout()
useWorkspaceStore.getState().restoreLayout()
```

## Development vs Production

| Aspect | Dev | Prod |
|--------|-----|------|
| App Name | "Merry (Dev)" | "Merry" |
| User Data Dir | `~/.merry-dev/` | `~/.merry/` |
| Default Port | 3333 | 3334 |
| Window Loading | http://localhost:5173 | file:///dist/index.html |
| DevTools | Opened | Closed |
| Server Entry | `../../server/dist/run.js` | `Resources/server/dist/run.js` |

## Logging

### Log Locations
```
~/.merry-dev/logs/     # Development logs
~/.merry/logs/         # Production logs
├─ main.log               # Main process logs
└─ server.log             # Server process logs
```

### Log Function
```javascript
function log(message: string, ...args: unknown[]): void
// Logs to console (dev) + file
// Format: [ISO_TIMESTAMP] [main] {message}
```

## Common Patterns

### Calling IPC from Renderer
```javascript
// Async
const result = await window.electronAPI.launcher.cursor(path)

// Listening to events
const unsubscribe = window.electronAPI.server.onInfo((info) => {
  console.log('Server port:', info.port)
})
```

### Handling Folder Selection
```javascript
if (window.electronAPI?.openFolder) {
  const path = await window.electronAPI.openFolder()
  if (path) {
    // Use path
  }
}
```

### Workspace State Management
```javascript
// Create console
useWorkspaceStore.getState().createConsole(agentId)

// Create terminal
useWorkspaceStore.getState().createTerminal(cwd)

// Update focused widget
useWorkspaceStore.getState().setFocusedWidget(widgetId, widgetType)

// Toggle maximize
useWorkspaceStore.getState().toggleMaximizeFocusedWidget()
```

## Troubleshooting

### Server Not Starting
1. Check `~/.merry(-dev)/logs/main.log` and `server.log`
2. Verify port 3333/3334 not in use: `lsof -i :3333`
3. Check server entry point exists
4. Verify `package.json` build is correct

### Window Not Showing
1. Check `nodeIntegration: false` is set
2. Verify `contextIsolation: true` is set
3. Check preload path is correct
4. DevTools: `mainWindow.webContents.openDevTools()`

### IPC Not Working
1. Check channel name matches exactly
2. Verify preload script is loaded
3. Check window.electronAPI is defined
4. Use browser console to test: `window.electronAPI`

### Port Conflicts
- Dev uses 3333 (can fallback to 3334, 3335, ...)
- Prod uses 3334 (can fallback to 3335, 3336, ...)
- Check: `netstat -an | grep 333`

## Build Configuration (electron-builder)

```json
{
  "appId": "com.merry.app",
  "productName": "Merry",
  "files": ["dist/**/*", "dist-electron/**/*"],
  "extraResources": [
    { "from": "server-bundle", "to": "server" }
  ],
  "mac": {
    "target": ["dmg", "zip"],
    "hardenedRuntime": true,
    "notarize": true
  },
  "win": { "target": ["nsis", "zip"] },
  "linux": { "target": ["AppImage", "deb"] }
}
```

## Key Files to Edit

| Task | Edit |
|------|------|
| Add IPC handler | `packages/ui/electron/main.ts` |
| Expose API to renderer | `packages/ui/electron/preload.ts` |
| Update type definitions | `packages/ui/src/types/electron.d.ts` |
| Window config | `packages/ui/electron/main.ts` (createWindow) |
| App startup | `packages/ui/src/App.tsx` |
| State management | `packages/ui/src/stores/*.ts` |
| Layout system | `packages/ui/src/stores/workspace.ts` |
