/**
 * Electron Main Process
 *
 * Handles:
 * - Window management
 * - Server lifecycle (start, restart, cleanup)
 * - IPC with renderer
 * - Native integrations
 *
 * Server startup follows T3 Code pattern:
 * - Uses Electron itself as Node runtime via ELECTRON_RUN_AS_NODE
 * - Proper process tracking with restart logic
 * - Clean shutdown on app quit
 */

import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as net from "net";
import { spawn, type ChildProcess } from "child_process";
import * as crypto from "crypto";
import * as os from "os";

// ============ Configuration ============

const DEFAULT_SERVER_PORT = 3333;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_BASE_MS = 1000;
const RESTART_BACKOFF_MAX_MS = 30000;
const SERVER_STARTUP_TIMEOUT_MS = 10000;
const LOG_DIR = path.join(os.homedir(), ".acc", "logs");
const PORT_FILE_POLL_MS = 50;
const PORT_FILE_TIMEOUT_MS = 5000;

// ============ State ============

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort = DEFAULT_SERVER_PORT;
let serverApiUrl = "";
let serverWsUrl = "";
let restartAttempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let isQuitting = false;

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

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
  
  if (app.isPackaged) {
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
}

// ============ Port Management ============

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(start: number = DEFAULT_SERVER_PORT): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  // Fallback to random port
  return start + Math.floor(Math.random() * 1000);
}

/** Poll for server-written port file (server may bind to different port on EADDRINUSE). */
async function readPortFile(portFilePath: string): Promise<number | null> {
  const deadline = Date.now() + PORT_FILE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(portFilePath)) {
        const raw = fs.readFileSync(portFilePath, "utf8").trim();
        const port = parseInt(raw, 10);
        if (Number.isFinite(port) && port > 0 && port < 65536) {
          try {
            fs.unlinkSync(portFilePath);
          } catch {
            // ignore
          }
          return port;
        }
      }
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, PORT_FILE_POLL_MS));
  }
  return null;
}

// ============ Health Check ============

async function isServerUp(port: number = serverPort): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(maxMs: number = SERVER_STARTUP_TIMEOUT_MS): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await isServerUp()) {
      return true;
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
  
  // Development: use bun to run TypeScript directly
  // Return null to signal we should use bun instead
  const serverDir = path.resolve(__dirname, "../../server");
  const srcEntry = path.join(serverDir, "src", "run.ts");
  if (fs.existsSync(srcEntry)) {
    return srcEntry;
  }
  
  log("Server entry not found at:", srcEntry);
  return null;
}

function resolveServerCwd(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "server");
  }
  return path.resolve(__dirname, "../../server");
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

  // Find available port
  serverPort = await findAvailablePort(DEFAULT_SERVER_PORT);
  log(`Starting server on port ${serverPort}...`);

  const cwd = resolveServerCwd();
  
  // Augment PATH for GUI launches (Spotlight doesn't inherit shell PATH)
  // Include common locations for claude CLI and other tools
  const extraPaths = [
    path.join(os.homedir(), ".local/bin"),      // claude CLI default location
    path.join(os.homedir(), ".cargo/bin"),       // Rust tools
    "/usr/local/bin",
    "/opt/homebrew/bin",
    path.join(os.homedir(), ".nvm/versions/node/v22.15.0/bin"),
    path.join(os.homedir(), ".nvm/versions/node/v20.19.0/bin"),
  ].join(path.delimiter);
  
  // Server may bind to a different port if requested port is in use; it writes actual port to ACC_PORT_FILE
  const portFilePath = path.join(os.tmpdir(), `acc-server-port-${process.pid}-${Date.now()}.txt`);
  const env = {
    ...process.env,
    PATH: `${extraPaths}${path.delimiter}${process.env.PATH || ""}`,
    ACC_SERVER_PORT: String(serverPort),
    ACC_PORT_FILE: portFilePath,
    NODE_ENV: isDev ? "development" : "production",
    FORCE_COLOR: "0",
  };

  let child: ChildProcess;

  if (app.isPackaged) {
    // Packaged: use Electron itself as Node runtime
    // This is the T3 Code pattern - guarantees Node is available
    child = spawn(process.execPath, [serverEntry], {
      cwd,
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    // Development: use bun to run TypeScript
    const bunCmd = process.platform === "win32" ? "bun.cmd" : "bun";
    child = spawn(bunCmd, ["run", serverEntry], {
      cwd,
      env,
      stdio: "inherit",
    });
  }

  serverProcess = child;

  // Wait for server to write actual port (in case it bound to a different port due to EADDRINUSE)
  const actualPort = await readPortFile(portFilePath);
  if (actualPort !== null && actualPort !== serverPort) {
    serverPort = actualPort;
    log(`Server bound to actual port ${serverPort}`);
  }

  // Log server output in production
  if (app.isPackaged) {
    ensureLogDir();
    const serverLogPath = path.join(LOG_DIR, "server.log");
    const serverLogStream = fs.createWriteStream(serverLogPath, { flags: "a" });
    
    child.stdout?.pipe(serverLogStream);
    child.stderr?.pipe(serverLogStream);
    
    const boundary = `\n=== Server started at ${new Date().toISOString()} pid=${child.pid} port=${serverPort} ===\n`;
    serverLogStream.write(boundary);
  }

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
    if (serverProcess === child) {
      serverProcess = null;
    }
    if (!isQuitting) {
      scheduleRestart(`exit code=${code} signal=${signal}`);
    }
  });

  // Wait for server to be ready
  const ready = await waitForServer();
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
  
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startServer();
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
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
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Pass server port to renderer
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.send("server-info", { port: serverPort });
  });
}

async function ensureServerThenCreateWindow(): Promise<void> {
  // Check if server is already running (e.g., from previous session or external)
  if (await isServerUp(DEFAULT_SERVER_PORT)) {
    serverPort = DEFAULT_SERVER_PORT;
    log("Server already running on default port");
  } else {
    await startServer();
  }
  
  // ALWAYS set env vars before creating window (T3 pattern)
  // The preload script reads these at load time
  serverApiUrl = `http://127.0.0.1:${serverPort}`;
  serverWsUrl = `ws://127.0.0.1:${serverPort}`;
  process.env.ACC_SERVER_API_URL = serverApiUrl;
  process.env.ACC_SERVER_WS_URL = serverWsUrl;
  log(`Set server URLs: API=${serverApiUrl} WS=${serverWsUrl}`);
  
  createWindow();
}

// ============ Single Instance (packaged app: one server, one window) ============

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Another instance was launched – focus this one instead of starting a new server
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ============ App Lifecycle ============

app.whenReady().then(() => {
  ensureServerThenCreateWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      ensureServerThenCreateWindow();
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

// ============ IPC Handlers ============

// Get server info
ipcMain.handle("server:info", () => {
  return { port: serverPort, pid: serverProcess?.pid };
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
ipcMain.handle("dialog:openFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
    title: "Select Project Folder",
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});
