/**
 * Electron Main Process
 *
 * Handles:
 * - Window management
 * - IPC with renderer
 * - Native integrations (PTY, file system)
 * - Auto-starting the companion server when not already running
 */

import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";

const SERVER_PORT = 3333;
const HEALTH_URL = `http://localhost:${SERVER_PORT}/health`;

let mainWindow: BrowserWindow | null = null;
let serverProcess: ReturnType<typeof spawn> | null = null;

const isDev = process.env.NODE_ENV === "development";

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isServerUp()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function getServerDir(): string | null {
  // Packaged app: server bundle in Resources
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, "server");
    try {
      fs.accessSync(path.join(bundled, "dist", "run.js"));
      return bundled;
    } catch {
      return null;
    }
  }
  // Dev: from packages/ui/electron or dist-electron -> packages/server
  const serverDir = path.resolve(__dirname, "../../server");
  try {
    fs.accessSync(path.join(serverDir, "src", "run.ts"));
    return serverDir;
  } catch {
    return null;
  }
}

function startServer(): Promise<boolean> {
  const serverDir = getServerDir();
  if (!serverDir) {
    console.warn("Dispatch: server dir not found, skipping auto-start");
    return Promise.resolve(false);
  }

  const isBundled =
    app.isPackaged && serverDir === path.join(process.resourcesPath, "server");
  const args = isBundled ? ["dist/run.js"] : ["run", "src/run.ts"];
  const cmd = isBundled
    ? "node"
    : process.platform === "win32"
      ? "bun.cmd"
      : "bun";

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: serverDir,
      stdio: "ignore",
      detached: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    child.unref();
    serverProcess = child;
    child.on("error", () => resolve(false));
    child.on("exit", (code) => {
      if (code !== 0 && code !== null)
        console.warn("Dispatch: server exited with code", code);
      serverProcess = null;
    });
    setTimeout(() => resolve(true), 500);
  });
}

async function ensureServerThenCreateWindow(): Promise<void> {
  if (!(await isServerUp())) {
    if (getServerDir()) {
      await startServer();
      const up = await waitForServer();
      if (!up)
        console.warn(
          "Dispatch: server did not become ready; UI may show connection errors.",
        );
    }
  }
  createWindow();
}

function createWindow() {
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
}

app.whenReady().then(() => {
  ensureServerThenCreateWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      ensureServerThenCreateWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// ============ IPC Handlers ============

// Adapter management
ipcMain.handle(
  "adapter:connect",
  async (_event, adapterId: string, config: unknown) => {
    // TODO: Implement adapter connection
    console.log("Connecting adapter:", adapterId, config);
    return { ok: true };
  },
);

ipcMain.handle("adapter:disconnect", async (_event, adapterId: string) => {
  // TODO: Implement adapter disconnection
  console.log("Disconnecting adapter:", adapterId);
  return { ok: true };
});

ipcMain.handle(
  "adapter:send",
  async (_event, adapterId: string, message: string) => {
    // TODO: Send message to adapter
    console.log("Sending to adapter:", adapterId, message);
    return { ok: true, turnId: crypto.randomUUID() };
  },
);

// Launchers
ipcMain.handle("launcher:cursor", async (_event, path: string) => {
  const { exec } = await import("child_process");
  return new Promise((resolve, reject) => {
    exec(`cursor "${path}"`, (error) => {
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
        },
      );
    });
  },
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
