/**
 * Electron Preload Script
 *
 * Exposes safe APIs to the renderer process via contextBridge
 */

import { contextBridge, ipcRenderer } from "electron";

// Track server port (updated via IPC from main)
let serverPort = 3333;

ipcRenderer.on("server-info", (_event, info: { port: number }) => {
  serverPort = info.port;
});

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // Server info
  server: {
    getInfo: () => ipcRenderer.invoke("server:info"),
    getPort: () => serverPort,
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

// Type declaration for renderer
declare global {
  interface Window {
    electronAPI: {
      server: {
        getInfo: () => Promise<{ port: number; pid?: number }>;
        getPort: () => number;
        onInfo: (callback: (info: { port: number }) => void) => () => void;
      };
      adapter: {
        connect: (
          adapterId: string,
          config: unknown,
        ) => Promise<{ ok: boolean }>;
        disconnect: (adapterId: string) => Promise<{ ok: boolean }>;
        send: (
          adapterId: string,
          message: string,
        ) => Promise<{ ok: boolean; turnId: string }>;
        onEvent: (callback: (event: unknown) => void) => () => void;
      };
      launcher: {
        cursor: (path: string) => Promise<{ ok: boolean }>;
        browser: (url: string) => Promise<{ ok: boolean }>;
      };
      coderabbit: {
        review: (cwd: string) => Promise<{ ok: boolean; output: string }>;
      };
      github: {
        createPr: (options: {
          title: string;
          body: string;
          cwd: string;
        }) => Promise<{ ok: boolean; output: string }>;
      };
      platform: NodeJS.Platform;
      openFolder: () => Promise<string | null>;
    };
  }
}
