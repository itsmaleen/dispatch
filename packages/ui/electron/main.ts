/**
 * Electron Main Process
 *
 * T3 Code Pattern:
 * - Electron ALWAYS spawns the server as a child process
 * - Dynamic port allocation (reserve before spawning)
 * - Server lifecycle fully managed by Electron
 * - Works identically in dev and packaged builds
 */

import { app, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as net from "net";
import { spawn, type ChildProcess } from "child_process";
import * as crypto from "crypto";
import * as os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ Configuration ============

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

// Separate identity for dev vs prod (allows running both simultaneously)
const APP_NAME = isDev ? "Dispatch (Dev)" : "Dispatch";
const USER_DATA_DIR = isDev ? "dispatch-dev" : "dispatch";

const DEFAULT_SERVER_PORT = isDev ? 3333 : 3334; // Different ports for dev/prod
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_BASE_MS = 1000;
const RESTART_BACKOFF_MAX_MS = 30000;
const SERVER_STARTUP_TIMEOUT_MS = 15000;
const STATE_DIR = path.join(os.homedir(), `.${USER_DATA_DIR}`);
const LOG_DIR = path.join(STATE_DIR, "logs");

// ============ Window Manager ============

class WindowManager {
  private windows: Map<number, BrowserWindow> = new Map();
  private windowCounter = 0;

  create(folderPath?: string): BrowserWindow {
    const windowId = ++this.windowCounter;
    const win = this.createWindow(windowId, folderPath);
    this.windows.set(win.id, win);

    win.on("closed", () => {
      this.windows.delete(win.id);
    });

    return win;
  }

  private createWindow(windowId: number, folderPath?: string): BrowserWindow {
    // Set env vars BEFORE creating window so preload can access them
    const apiUrl = `http://127.0.0.1:${serverPort}`;
    const wsUrl = `ws://127.0.0.1:${serverPort}`;
    process.env.ACC_SERVER_API_URL = apiUrl;
    process.env.ACC_SERVER_WS_URL = wsUrl;

    log(`Creating window ${windowId} - Server URLs: API=${apiUrl} WS=${wsUrl}`);

    const win = new BrowserWindow({
      title: APP_NAME,
      width: 1400,
      height: 900,
      minWidth: 1000,
      minHeight: 600,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 16 },
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "preload.js"),
        additionalArguments: [`--window-id=${windowId}`],
      },
    });

    if (isDev) {
      // In dev, load from Vite dev server
      const viteUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
      const urlWithWindowId = `${viteUrl}?windowId=${windowId}${folderPath ? `&folder=${encodeURIComponent(folderPath)}` : ''}`;
      win.loadURL(urlWithWindowId);
      win.webContents.openDevTools();
    } else {
      const htmlPath = path.join(__dirname, "../dist/index.html");
      const urlParams = `?windowId=${windowId}${folderPath ? `&folder=${encodeURIComponent(folderPath)}` : ''}`;
      win.loadFile(htmlPath, { search: urlParams });
    }

    // Send server info once page loads
    win.webContents.on("did-finish-load", () => {
      win.webContents.send("server-info", {
        port: serverPort,
        apiUrl,
        wsUrl,
        windowId,
        folderPath,
      });
    });

    return win;
  }

  getAll(): BrowserWindow[] {
    return Array.from(this.windows.values());
  }

  get(id: number): BrowserWindow | undefined {
    return this.windows.get(id);
  }

  getFocused(): BrowserWindow | null {
    return BrowserWindow.getFocusedWindow();
  }

  getCount(): number {
    return this.windows.size;
  }
}

// ============ State ============

const windowManager = new WindowManager();
let serverProcess: ChildProcess | null = null;
let serverPort = 0; // Dynamically assigned
let serverAuthToken = "";
let restartAttempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let isQuitting = false;

// ============ Logging ============

function ensureLogDir(): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // Ignore
  }
}

function log(message: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [main] ${message}`;
  console.log(line, ...args);
  
  try {
    ensureLogDir();
    fs.appendFileSync(
      path.join(LOG_DIR, "main.log"),
      `${line} ${args.map(a => JSON.stringify(a)).join(" ")}\n`
    );
  } catch {
    // Ignore log write errors
  }
}

// ============ Port Management ============

/**
 * Reserve a port by binding to it, then immediately closing.
 * This is the T3 Code pattern - guarantees the port is available.
 */
async function reservePort(preferredPort: number = DEFAULT_SERVER_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Port in use, try next
        server.close();
        reservePort(preferredPort + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
    
    server.once("listening", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : preferredPort;
      server.close(() => resolve(port));
    });
    
    server.listen(preferredPort, "127.0.0.1");
  });
}

// ============ Health Check ============

async function waitForServerReady(port: number, maxMs: number = SERVER_STARTUP_TIMEOUT_MS): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ============ Server Lifecycle ============

function resolveServerEntry(): string | null {
  if (app.isPackaged) {
    // Packaged: server bundle in Resources/server
    const bundled = path.join(process.resourcesPath, "server", "dist", "run.js");
    if (fs.existsSync(bundled)) {
      return bundled;
    }
    log("Server entry not found at:", bundled);
    return null;
  }
  
  // Development: pre-built JavaScript (built by tsup --watch)
  // This matches the T3 Code pattern - always run compiled JS, never TS directly
  const serverDir = path.resolve(__dirname, "../../server");
  const distEntry = path.join(serverDir, "dist", "run.js");
  if (fs.existsSync(distEntry)) {
    return distEntry;
  }
  
  log("Server entry not found at:", distEntry);
  log("Make sure server is building (turbo should run @acc/server dev)");
  return null;
}

function resolveServerCwd(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "server");
  }
  return path.resolve(__dirname, "../../server");
}

/**
 * Build environment variables for the server process.
 * Follows T3 Code pattern of passing config via env.
 */
function buildServerEnv(): NodeJS.ProcessEnv {
  // Get monorepo root for node_modules/.bin
  const monorepoRoot = path.resolve(__dirname, "../../..");
  const nodeModulesBin = path.join(monorepoRoot, "node_modules", ".bin");
  
  // Augment PATH for GUI launches (Spotlight doesn't inherit shell PATH)
  const extraPaths = [
    nodeModulesBin,                              // monorepo binaries (tsx, etc.)
    path.join(os.homedir(), ".local/bin"),       // claude CLI default location
    path.join(os.homedir(), ".cargo/bin"),       // Rust tools
    "/usr/local/bin",
    "/opt/homebrew/bin",
    path.join(os.homedir(), ".nvm/versions/node/v22.15.0/bin"),
    path.join(os.homedir(), ".nvm/versions/node/v20.19.0/bin"),
    path.join(os.homedir(), ".bun/bin"),
  ].join(path.delimiter);

  return {
    ...process.env,
    PATH: `${extraPaths}${path.delimiter}${process.env.PATH || ""}`,
    ACC_MODE: "desktop",
    ACC_SERVER_PORT: String(serverPort),
    ACC_AUTH_TOKEN: serverAuthToken,
    ACC_STATE_DIR: STATE_DIR,
    ACC_NO_BROWSER: "1",
    NODE_ENV: isDev ? "development" : "production",
    FORCE_COLOR: "0",
  };
}

async function startServer(): Promise<boolean> {
  if (isQuitting || serverProcess) {
    return false;
  }

  const serverEntry = resolveServerEntry();
  if (!serverEntry) {
    log("Cannot start server: entry point not found");
    return false;
  }

  // Reserve port BEFORE spawning (T3 pattern)
  try {
    serverPort = await reservePort(DEFAULT_SERVER_PORT);
    log(`Reserved port ${serverPort}`);
  } catch (err) {
    log("Failed to reserve port:", err);
    return false;
  }

  // Generate auth token for this session
  serverAuthToken = crypto.randomBytes(24).toString("hex");

  const cwd = resolveServerCwd();
  const env = buildServerEnv();
  
  log(`Starting server on port ${serverPort}...`);
  log(`Server entry: ${serverEntry}`);
  log(`Server cwd: ${cwd}`);

  // T3 Code pattern: ALWAYS use Electron itself as Node runtime
  // This works in both dev and production because server is pre-built to JS
  const child = spawn(process.execPath, [serverEntry], {
    cwd,
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess = child;

  // Capture server output
  ensureLogDir();
  const serverLogPath = path.join(LOG_DIR, "server.log");
  const serverLogStream = fs.createWriteStream(serverLogPath, { flags: "a" });
  
  const boundary = `\n=== Server started at ${new Date().toISOString()} pid=${child.pid} port=${serverPort} ===\n`;
  serverLogStream.write(boundary);
  
  child.stdout?.on("data", (data) => {
    serverLogStream.write(data);
    if (isDev) {
      process.stdout.write(`[server] ${data}`);
    }
  });
  
  child.stderr?.on("data", (data) => {
    serverLogStream.write(data);
    if (isDev) {
      process.stderr.write(`[server] ${data}`);
    }
  });

  child.once("spawn", () => {
    log(`Server process spawned (pid=${child.pid})`);
    restartAttempt = 0;
  });

  child.on("error", (error) => {
    log("Server process error:", error.message);
    if (serverProcess === child) {
      serverProcess = null;
    }
    scheduleRestart(`error: ${error.message}`);
  });

  child.on("exit", (code, signal) => {
    log(`Server process exited (code=${code}, signal=${signal})`);
    serverLogStream.write(`\n=== Server exited code=${code} signal=${signal} ===\n`);
    serverLogStream.end();
    
    if (serverProcess === child) {
      serverProcess = null;
    }
    if (!isQuitting) {
      scheduleRestart(`exit code=${code} signal=${signal}`);
    }
  });

  // Wait for server to be ready
  const ready = await waitForServerReady(serverPort);
  if (ready) {
    log("Server is ready");
  } else {
    log("Server did not become ready in time");
  }
  
  return ready;
}

function scheduleRestart(reason: string): void {
  if (isQuitting || restartTimer) {
    return;
  }

  if (restartAttempt >= MAX_RESTART_ATTEMPTS) {
    log(`Server restart limit reached (${MAX_RESTART_ATTEMPTS}), giving up`);
    return;
  }

  const delayMs = Math.min(
    RESTART_BACKOFF_BASE_MS * Math.pow(2, restartAttempt),
    RESTART_BACKOFF_MAX_MS
  );
  restartAttempt++;

  log(`Scheduling server restart in ${delayMs}ms (attempt ${restartAttempt}, reason: ${reason})`);
  
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    const started = await startServer();
    if (started) {
      // Notify all windows of new server URL
      for (const win of windowManager.getAll()) {
        win.webContents.send("server-info", {
          port: serverPort,
          apiUrl: `http://127.0.0.1:${serverPort}`,
          wsUrl: `ws://127.0.0.1:${serverPort}`,
        });
      }
    }
  }, delayMs);
}

function stopServer(): void {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = serverProcess;
  serverProcess = null;
  
  if (!child) {
    return;
  }

  log("Stopping server...");

  // Try graceful shutdown first
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    
    // Force kill after timeout
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        log("Force killing server...");
        child.kill("SIGKILL");
      }
    }, 2000);
  }
}

// ============ Window Management ============

async function bootstrap(): Promise<void> {
  log("Bootstrap starting...");

  // Always start our own server (T3 pattern - no checking for existing)
  const serverStarted = await startServer();
  if (!serverStarted) {
    log("Warning: Server failed to start, app may not work correctly");
  }

  // Create first window
  windowManager.create();

  // Create application menu with multi-window support
  createApplicationMenu();

  log("Bootstrap complete");
}

function createApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            windowManager.create();
          }
        },
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog({
              properties: ['openDirectory'],
              title: 'Select Project Folder',
            });

            if (!result.canceled && result.filePaths.length > 0) {
              windowManager.create(result.filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ============ App Identity (Dev vs Prod) ============

// Set app name and user data path BEFORE requesting single instance lock
// This allows dev and prod to run simultaneously
app.name = APP_NAME;
app.setPath("userData", path.join(os.homedir(), "Library", "Application Support", USER_DATA_DIR));

log(`App identity: ${APP_NAME} (isDev=${isDev})`);
log(`User data: ${app.getPath("userData")}`);

// ============ Single Instance ============

// Use different instance lock names for dev vs prod
// When a second instance is launched, create a new window instead of quitting
const gotSingleInstanceLock = app.requestSingleInstanceLock({ key: USER_DATA_DIR });

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, create a new window instead
    log("Second instance detected, creating new window");
    windowManager.create();
  });
}

// ============ App Lifecycle ============

app.whenReady().then(() => {
  bootstrap().catch((error) => {
    log("Bootstrap failed:", error);
    dialog.showErrorBox("Dispatch failed to start", String(error));
    app.quit();
  });

  app.on("activate", () => {
    // On macOS, create a new window when clicking the dock icon if no windows exist
    if (windowManager.getCount() === 0) {
      windowManager.create();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Handle SIGINT/SIGTERM for clean shutdown
if (process.platform !== "win32") {
  process.on("SIGINT", () => {
    if (isQuitting) return;
    isQuitting = true;
    stopServer();
    app.quit();
  });
  
  process.on("SIGTERM", () => {
    if (isQuitting) return;
    isQuitting = true;
    stopServer();
    app.quit();
  });
}

// ============ IPC Handlers ============

// Sync handler for preload to get server URLs
ipcMain.on("server:get-urls", (event) => {
  event.returnValue = {
    apiUrl: `http://127.0.0.1:${serverPort}`,
    wsUrl: `ws://127.0.0.1:${serverPort}`,
  };
});

// Get server info
ipcMain.handle("server:info", () => {
  return { 
    port: serverPort, 
    pid: serverProcess?.pid,
    apiUrl: `http://127.0.0.1:${serverPort}`,
    wsUrl: `ws://127.0.0.1:${serverPort}`,
  };
});

// Restart server (for debugging/recovery)
ipcMain.handle("server:restart", async () => {
  log("Manual server restart requested");
  stopServer();
  await new Promise(r => setTimeout(r, 500));
  return startServer();
});

// Adapter management
ipcMain.handle(
  "adapter:connect",
  async (_event, adapterId: string, config: unknown) => {
    log("Connecting adapter:", adapterId);
    return { ok: true };
  }
);

ipcMain.handle("adapter:disconnect", async (_event, adapterId: string) => {
  log("Disconnecting adapter:", adapterId);
  return { ok: true };
});

ipcMain.handle(
  "adapter:send",
  async (_event, adapterId: string, message: string) => {
    log("Sending to adapter:", adapterId);
    return { ok: true, turnId: crypto.randomUUID() };
  }
);

// Launchers
ipcMain.handle("launcher:cursor", async (_event, projectPath: string) => {
  const { exec } = await import("child_process");
  return new Promise((resolve, reject) => {
    exec(`cursor "${projectPath}"`, (error) => {
      if (error) reject(error);
      else resolve({ ok: true });
    });
  });
});

ipcMain.handle("launcher:browser", async (_event, url: string) => {
  const { shell } = await import("electron");
  await shell.openExternal(url);
  return { ok: true };
});

// CodeRabbit CLI
ipcMain.handle("coderabbit:review", async (_event, cwd: string) => {
  const { exec } = await import("child_process");
  return new Promise((resolve, reject) => {
    exec("cr --prompt-only", { cwd }, (error, stdout, stderr) => {
      if (error) reject({ error: error.message, stderr });
      else resolve({ ok: true, output: stdout });
    });
  });
});

// GitHub CLI
ipcMain.handle(
  "github:createPr",
  async (_event, options: { title: string; body: string; cwd: string }) => {
    const { exec } = await import("child_process");
    return new Promise((resolve, reject) => {
      exec(
        `gh pr create --title "${options.title}" --body "${options.body}"`,
        { cwd: options.cwd },
        (error, stdout, stderr) => {
          if (error) reject({ error: error.message, stderr });
          else resolve({ ok: true, output: stdout });
        }
      );
    });
  }
);

// Dialog: Open Folder
ipcMain.handle("dialog:openFolder", async (event, defaultPath?: string) => {
  // Get the window that sent the request
  const window = BrowserWindow.fromWebContents(event.sender);

  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ["openDirectory"],
    title: "Select Project Folder",
    defaultPath: defaultPath || undefined,
  };

  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

// Window management IPC handlers
ipcMain.handle("window:create", async (_event, folderPath?: string) => {
  windowManager.create(folderPath);
  return { ok: true };
});
