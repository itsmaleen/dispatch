/**
 * Electron Preload Script
 *
 * Exposes safe APIs to the renderer process via contextBridge
 */

import { contextBridge, ipcRenderer } from "electron";

// Server URLs - try env vars first, then sync IPC as fallback
// The main process sets these before creating the window
let serverApiUrl = process.env.ACC_SERVER_API_URL || "";
let serverWsUrl = process.env.ACC_SERVER_WS_URL || "";

// If env vars not set, use sync IPC to get the URLs from main process
if (!serverApiUrl || !serverWsUrl) {
  try {
    const info = ipcRenderer.sendSync("server:get-urls");
    if (info && typeof info === 'object') {
      serverApiUrl = info.apiUrl || "http://127.0.0.1:3333";
      serverWsUrl = info.wsUrl || "ws://127.0.0.1:3333";
    }
  } catch (e) {
    console.warn("[preload] Failed to get server URLs via IPC:", e);
  }
}

// Final fallback to defaults
if (!serverApiUrl) serverApiUrl = "http://127.0.0.1:3333";
if (!serverWsUrl) serverWsUrl = "ws://127.0.0.1:3333";

// Extract port from URL for backward compatibility
const serverPort = parseInt(new URL(serverApiUrl).port) || 3333;

// Debug logging
console.log("[preload] Server URLs resolution:");
console.log("[preload]   ENV ACC_SERVER_API_URL:", process.env.ACC_SERVER_API_URL || "(not set)");
console.log("[preload]   ENV ACC_SERVER_WS_URL:", process.env.ACC_SERVER_WS_URL || "(not set)");
console.log("[preload]   Final API URL:", serverApiUrl);
console.log("[preload]   Final WS URL:", serverWsUrl);
console.log("[preload]   Final port:", serverPort);

// Still listen for updates (in case server rebinds after window loads)
ipcRenderer.on("server-info", (_event, info: { port: number }) => {
  // Note: This won't update the URLs already captured above,
  // but the env var approach should handle most cases
  console.log("[preload] Server info update:", info);
});

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // Server info - URLs available immediately (no race condition)
  server: {
    getInfo: () => ipcRenderer.invoke("server:info"),
    getPort: () => serverPort,
    getApiUrl: () => serverApiUrl,
    getWsUrl: () => serverWsUrl,
    onInfo: (callback: (info: { port: number }) => void) => {
      const handler = (_event: unknown, info: { port: number }) => callback(info);
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
  openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
});

// Type declaration for renderer is in src/types/electron.d.ts
