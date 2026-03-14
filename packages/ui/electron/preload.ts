/**
 * Electron Preload Script
 *
 * Exposes safe APIs to the renderer process via contextBridge
 */

import { contextBridge, ipcRenderer } from "electron";

// Server URLs from env vars (set by main process before window creation - T3 pattern)
// This avoids the race condition of IPC-based port communication
const serverApiUrl = process.env.ACC_SERVER_API_URL || "http://127.0.0.1:3333";
const serverWsUrl = process.env.ACC_SERVER_WS_URL || "ws://127.0.0.1:3333";

// Extract port from URL for backward compatibility
const serverPort = parseInt(new URL(serverApiUrl).port) || 3333;

// Debug logging
console.log("[preload] Server URLs from env:");
console.log("[preload]   ACC_SERVER_API_URL env:", process.env.ACC_SERVER_API_URL);
console.log("[preload]   ACC_SERVER_WS_URL env:", process.env.ACC_SERVER_WS_URL);
console.log("[preload]   Resolved API URL:", serverApiUrl);
console.log("[preload]   Resolved WS URL:", serverWsUrl);
console.log("[preload]   Resolved port:", serverPort);

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
