"use strict";
/**
 * Electron Preload Script
 *
 * Exposes safe APIs to the renderer process via contextBridge
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Server URLs from env vars (set by main process before window creation - T3 pattern)
// This avoids the race condition of IPC-based port communication
const serverApiUrl = process.env.ACC_SERVER_API_URL || "http://127.0.0.1:3333";
const serverWsUrl = process.env.ACC_SERVER_WS_URL || "ws://127.0.0.1:3333";
// Extract port from URL for backward compatibility
const serverPort = parseInt(new URL(serverApiUrl).port) || 3333;
// Still listen for updates (in case server rebinds after window loads)
electron_1.ipcRenderer.on("server-info", (_event, info) => {
    // Note: This won't update the URLs already captured above,
    // but the env var approach should handle most cases
    console.log("[preload] Server info update:", info);
});
// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
electron_1.contextBridge.exposeInMainWorld("electronAPI", {
    // Server info - URLs available immediately (no race condition)
    server: {
        getInfo: () => electron_1.ipcRenderer.invoke("server:info"),
        getPort: () => serverPort,
        getApiUrl: () => serverApiUrl,
        getWsUrl: () => serverWsUrl,
        onInfo: (callback) => {
            const handler = (_event, info) => callback(info);
            electron_1.ipcRenderer.on("server-info", handler);
            return () => electron_1.ipcRenderer.removeListener("server-info", handler);
        },
    },
    // Adapter operations
    adapter: {
        connect: (adapterId, config) => electron_1.ipcRenderer.invoke("adapter:connect", adapterId, config),
        disconnect: (adapterId) => electron_1.ipcRenderer.invoke("adapter:disconnect", adapterId),
        send: (adapterId, message) => electron_1.ipcRenderer.invoke("adapter:send", adapterId, message),
        onEvent: (callback) => {
            const handler = (_event, data) => callback(data);
            electron_1.ipcRenderer.on("adapter:event", handler);
            return () => electron_1.ipcRenderer.removeListener("adapter:event", handler);
        },
    },
    // Launchers
    launcher: {
        cursor: (path) => electron_1.ipcRenderer.invoke("launcher:cursor", path),
        browser: (url) => electron_1.ipcRenderer.invoke("launcher:browser", url),
    },
    // CodeRabbit
    coderabbit: {
        review: (cwd) => electron_1.ipcRenderer.invoke("coderabbit:review", cwd),
    },
    // GitHub
    github: {
        createPr: (options) => electron_1.ipcRenderer.invoke("github:createPr", options),
    },
    // System
    platform: process.platform,
    // Project
    openFolder: () => electron_1.ipcRenderer.invoke("dialog:openFolder"),
});
