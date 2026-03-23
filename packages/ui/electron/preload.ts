/**
 * Electron Preload Script
 *
 * Exposes safe APIs to the renderer process via contextBridge.
 *
 * T3 Code Pattern:
 * - Server URLs are set by main process BEFORE window is created
 * - Available via env vars or sync IPC fallback
 * - Listen for server-info events for dynamic updates (e.g., server restart)
 * - Window ID is passed via additionalArguments for multi-window support
 */

import { contextBridge, ipcRenderer } from "electron";

// Extract window ID from process arguments (passed via additionalArguments)
let windowId = 1; // default to 1
const windowIdArg = process.argv.find(arg => arg.startsWith('--window-id='));
if (windowIdArg) {
  windowId = parseInt(windowIdArg.split('=')[1], 10) || 1;
}

console.log("[preload] Window ID:", windowId);

// Server URLs - get from main process via sync IPC (most reliable)
let serverApiUrl = "";
let serverWsUrl = "";
let serverPort = 0;
let initialFolderPath: string | undefined;

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

// Fallback to env vars if IPC failed
if (!serverApiUrl) {
  serverApiUrl = process.env.ACC_SERVER_API_URL || "http://127.0.0.1:3333";
  serverWsUrl = process.env.ACC_SERVER_WS_URL || "ws://127.0.0.1:3333";
  serverPort = parseInt(new URL(serverApiUrl).port) || 3333;
}

console.log("[preload] Server URLs resolved:");
console.log("[preload]   API:", serverApiUrl);
console.log("[preload]   WS:", serverWsUrl);
console.log("[preload]   Port:", serverPort);

// Listen for server info updates (e.g., after server restart)
ipcRenderer.on("server-info", (_event, info: {
  port: number;
  apiUrl?: string;
  wsUrl?: string;
  windowId?: number;
  folderPath?: string;
}) => {
  console.log("[preload] Server info updated:", info);
  if (info.apiUrl) serverApiUrl = info.apiUrl;
  if (info.wsUrl) serverWsUrl = info.wsUrl;
  if (info.port) serverPort = info.port;
  if (info.folderPath) initialFolderPath = info.folderPath;
});

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // Window info - for multi-window support
  window: {
    getId: () => windowId,
    getInitialFolderPath: () => initialFolderPath,
    create: (folderPath?: string) => ipcRenderer.invoke("window:create", folderPath),
    // Window close handling - allows renderer to save state before close
    onClosing: (callback: () => Promise<void>) => {
      const handler = async () => {
        try {
          await callback();
        } catch (err) {
          console.error("[preload] Error in onClosing callback:", err);
        }
        // Signal to main process that we're ready to close
        ipcRenderer.send("window:close-ready");
      };
      ipcRenderer.on("window:closing", handler);
      return () => ipcRenderer.removeListener("window:closing", handler);
    },
  },

  // Server info - URLs available immediately (no race condition)
  server: {
    getInfo: () => ipcRenderer.invoke("server:info"),
    getPort: () => serverPort,
    getApiUrl: () => serverApiUrl,
    getWsUrl: () => serverWsUrl,
    onInfo: (callback: (info: { port: number; windowId?: number; folderPath?: string }) => void) => {
      const handler = (_event: unknown, info: { port: number; windowId?: number; folderPath?: string }) => callback(info);
      ipcRenderer.on("server-info", handler);
      return () => ipcRenderer.removeListener("server-info", handler);
    },
  },

  // Adapter operations
  adapter: {
    connect: (adapterId: string, config: unknown) =>
      ipcRenderer.invoke("adapter:connect", adapterId, config),
    disconnect: (adapterId: string) =>
      ipcRenderer.invoke("adapter:disconnect", adapterId),
    send: (adapterId: string, message: string) =>
      ipcRenderer.invoke("adapter:send", adapterId, message),
    onEvent: (callback: (event: unknown) => void) => {
      const handler = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on("adapter:event", handler);
      return () => ipcRenderer.removeListener("adapter:event", handler);
    },
  },

  // Launchers
  launcher: {
    cursor: (path: string) => ipcRenderer.invoke("launcher:cursor", path),
    browser: (url: string) => ipcRenderer.invoke("launcher:browser", url),
  },

  // CodeRabbit
  coderabbit: {
    review: (cwd: string) => ipcRenderer.invoke("coderabbit:review", cwd),
  },

  // GitHub
  github: {
    createPr: (options: { title: string; body: string; cwd: string }) =>
      ipcRenderer.invoke("github:createPr", options),
  },

  // System
  platform: process.platform,

  // Project
  openFolder: (defaultPath?: string) => ipcRenderer.invoke("dialog:openFolder", defaultPath),
});

// Type declaration for renderer is in src/types/electron.d.ts
