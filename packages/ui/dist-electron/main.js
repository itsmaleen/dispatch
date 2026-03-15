"use strict";
/**
 * Electron Main Process
 *
 * T3 Code Pattern:
 * - Electron ALWAYS spawns the server as a child process
 * - Dynamic port allocation (reserve before spawning)
 * - Server lifecycle fully managed by Electron
 * - Works identically in dev and packaged builds
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const net = __importStar(require("net"));
const child_process_1 = require("child_process");
const crypto = __importStar(require("crypto"));
const os = __importStar(require("os"));
// ============ Configuration ============
const DEFAULT_SERVER_PORT = 3333;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_BASE_MS = 1000;
const RESTART_BACKOFF_MAX_MS = 30000;
const SERVER_STARTUP_TIMEOUT_MS = 15000;
const LOG_DIR = path.join(os.homedir(), ".acc", "logs");
const STATE_DIR = path.join(os.homedir(), ".acc");
// ============ State ============
let mainWindow = null;
let serverProcess = null;
let serverPort = 0; // Dynamically assigned
let serverAuthToken = "";
let restartAttempt = 0;
let restartTimer = null;
let isQuitting = false;
const isDev = process.env.NODE_ENV === "development" || !electron_1.app.isPackaged;
// ============ Logging ============
function ensureLogDir() {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    catch {
        // Ignore
    }
}
function log(message, ...args) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [main] ${message}`;
    console.log(line, ...args);
    try {
        ensureLogDir();
        fs.appendFileSync(path.join(LOG_DIR, "main.log"), `${line} ${args.map(a => JSON.stringify(a)).join(" ")}\n`);
    }
    catch {
        // Ignore log write errors
    }
}
// ============ Port Management ============
/**
 * Reserve a port by binding to it, then immediately closing.
 * This is the T3 Code pattern - guarantees the port is available.
 */
async function reservePort(preferredPort = DEFAULT_SERVER_PORT) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", (err) => {
            if (err.code === "EADDRINUSE") {
                // Port in use, try next
                server.close();
                reservePort(preferredPort + 1).then(resolve).catch(reject);
            }
            else {
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
async function waitForServerReady(port, maxMs = SERVER_STARTUP_TIMEOUT_MS) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/health`, {
                signal: AbortSignal.timeout(1000),
            });
            if (res.ok) {
                return true;
            }
        }
        catch {
            // Not ready yet
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    return false;
}
// ============ Server Lifecycle ============
function resolveServerEntry() {
    if (electron_1.app.isPackaged) {
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
function resolveServerCwd() {
    if (electron_1.app.isPackaged) {
        return path.join(process.resourcesPath, "server");
    }
    return path.resolve(__dirname, "../../server");
}
/**
 * Build environment variables for the server process.
 * Follows T3 Code pattern of passing config via env.
 */
function buildServerEnv() {
    // Get monorepo root for node_modules/.bin
    const monorepoRoot = path.resolve(__dirname, "../../..");
    const nodeModulesBin = path.join(monorepoRoot, "node_modules", ".bin");
    // Augment PATH for GUI launches (Spotlight doesn't inherit shell PATH)
    const extraPaths = [
        nodeModulesBin, // monorepo binaries (tsx, etc.)
        path.join(os.homedir(), ".local/bin"), // claude CLI default location
        path.join(os.homedir(), ".cargo/bin"), // Rust tools
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
async function startServer() {
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
    }
    catch (err) {
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
    const child = (0, child_process_1.spawn)(process.execPath, [serverEntry], {
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
    }
    else {
        log("Server did not become ready in time");
    }
    return ready;
}
function scheduleRestart(reason) {
    if (isQuitting || restartTimer) {
        return;
    }
    if (restartAttempt >= MAX_RESTART_ATTEMPTS) {
        log(`Server restart limit reached (${MAX_RESTART_ATTEMPTS}), giving up`);
        return;
    }
    const delayMs = Math.min(RESTART_BACKOFF_BASE_MS * Math.pow(2, restartAttempt), RESTART_BACKOFF_MAX_MS);
    restartAttempt++;
    log(`Scheduling server restart in ${delayMs}ms (attempt ${restartAttempt}, reason: ${reason})`);
    restartTimer = setTimeout(async () => {
        restartTimer = null;
        const started = await startServer();
        if (started) {
            // Notify renderer of new server URL
            mainWindow?.webContents.send("server-info", {
                port: serverPort,
                apiUrl: `http://127.0.0.1:${serverPort}`,
                wsUrl: `ws://127.0.0.1:${serverPort}`,
            });
        }
    }, delayMs);
}
function stopServer() {
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
function createWindow() {
    // Set env vars BEFORE creating window so preload can access them
    const apiUrl = `http://127.0.0.1:${serverPort}`;
    const wsUrl = `ws://127.0.0.1:${serverPort}`;
    process.env.ACC_SERVER_API_URL = apiUrl;
    process.env.ACC_SERVER_WS_URL = wsUrl;
    log(`Server URLs: API=${apiUrl} WS=${wsUrl}`);
    mainWindow = new electron_1.BrowserWindow({
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
        // In dev, load from Vite dev server
        const viteUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
        mainWindow.loadURL(viteUrl);
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    }
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    // Send server info once page loads
    mainWindow.webContents.on("did-finish-load", () => {
        mainWindow?.webContents.send("server-info", {
            port: serverPort,
            apiUrl,
            wsUrl,
        });
    });
}
async function bootstrap() {
    log("Bootstrap starting...");
    // Always start our own server (T3 pattern - no checking for existing)
    const serverStarted = await startServer();
    if (!serverStarted) {
        log("Warning: Server failed to start, app may not work correctly");
    }
    createWindow();
    log("Bootstrap complete");
}
// ============ Single Instance ============
const gotSingleInstanceLock = electron_1.app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
}
// ============ App Lifecycle ============
electron_1.app.whenReady().then(() => {
    bootstrap().catch((error) => {
        log("Bootstrap failed:", error);
        electron_1.dialog.showErrorBox("Dispatch failed to start", String(error));
        electron_1.app.quit();
    });
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            bootstrap();
        }
    });
});
electron_1.app.on("before-quit", () => {
    isQuitting = true;
    stopServer();
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
// Handle SIGINT/SIGTERM for clean shutdown
if (process.platform !== "win32") {
    process.on("SIGINT", () => {
        if (isQuitting)
            return;
        isQuitting = true;
        stopServer();
        electron_1.app.quit();
    });
    process.on("SIGTERM", () => {
        if (isQuitting)
            return;
        isQuitting = true;
        stopServer();
        electron_1.app.quit();
    });
}
// ============ IPC Handlers ============
// Sync handler for preload to get server URLs
electron_1.ipcMain.on("server:get-urls", (event) => {
    event.returnValue = {
        apiUrl: `http://127.0.0.1:${serverPort}`,
        wsUrl: `ws://127.0.0.1:${serverPort}`,
    };
});
// Get server info
electron_1.ipcMain.handle("server:info", () => {
    return {
        port: serverPort,
        pid: serverProcess?.pid,
        apiUrl: `http://127.0.0.1:${serverPort}`,
        wsUrl: `ws://127.0.0.1:${serverPort}`,
    };
});
// Restart server (for debugging/recovery)
electron_1.ipcMain.handle("server:restart", async () => {
    log("Manual server restart requested");
    stopServer();
    await new Promise(r => setTimeout(r, 500));
    return startServer();
});
// Adapter management
electron_1.ipcMain.handle("adapter:connect", async (_event, adapterId, config) => {
    log("Connecting adapter:", adapterId);
    return { ok: true };
});
electron_1.ipcMain.handle("adapter:disconnect", async (_event, adapterId) => {
    log("Disconnecting adapter:", adapterId);
    return { ok: true };
});
electron_1.ipcMain.handle("adapter:send", async (_event, adapterId, message) => {
    log("Sending to adapter:", adapterId);
    return { ok: true, turnId: crypto.randomUUID() };
});
// Launchers
electron_1.ipcMain.handle("launcher:cursor", async (_event, projectPath) => {
    const { exec } = await Promise.resolve().then(() => __importStar(require("child_process")));
    return new Promise((resolve, reject) => {
        exec(`cursor "${projectPath}"`, (error) => {
            if (error)
                reject(error);
            else
                resolve({ ok: true });
        });
    });
});
electron_1.ipcMain.handle("launcher:browser", async (_event, url) => {
    const { shell } = await Promise.resolve().then(() => __importStar(require("electron")));
    await shell.openExternal(url);
    return { ok: true };
});
// CodeRabbit CLI
electron_1.ipcMain.handle("coderabbit:review", async (_event, cwd) => {
    const { exec } = await Promise.resolve().then(() => __importStar(require("child_process")));
    return new Promise((resolve, reject) => {
        exec("cr --prompt-only", { cwd }, (error, stdout, stderr) => {
            if (error)
                reject({ error: error.message, stderr });
            else
                resolve({ ok: true, output: stdout });
        });
    });
});
// GitHub CLI
electron_1.ipcMain.handle("github:createPr", async (_event, options) => {
    const { exec } = await Promise.resolve().then(() => __importStar(require("child_process")));
    return new Promise((resolve, reject) => {
        exec(`gh pr create --title "${options.title}" --body "${options.body}"`, { cwd: options.cwd }, (error, stdout, stderr) => {
            if (error)
                reject({ error: error.message, stderr });
            else
                resolve({ ok: true, output: stdout });
        });
    });
});
// Dialog: Open Folder
electron_1.ipcMain.handle("dialog:openFolder", async () => {
    const result = await electron_1.dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"],
        title: "Select Project Folder",
    });
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }
    return result.filePaths[0];
});
