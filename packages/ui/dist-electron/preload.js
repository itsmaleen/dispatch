"use strict";
/**
 * Electron Preload Script
 *
 * Exposes safe APIs to the renderer process via contextBridge
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Server URLs - try env vars first, then sync IPC as fallback
// The main process sets these before creating the window
let serverApiUrl = process.env.ACC_SERVER_API_URL || "";
let serverWsUrl = process.env.ACC_SERVER_WS_URL || "";
// If env vars not set, use sync IPC to get the URLs from main process
if (!serverApiUrl || !serverWsUrl) {
    try {
        const info = electron_1.ipcRenderer.sendSync("server:get-urls");
        if (info && typeof info === 'object') {
            serverApiUrl = info.apiUrl || "http://127.0.0.1:3333";
            serverWsUrl = info.wsUrl || "ws://127.0.0.1:3333";
        }
    }
    catch (e) {
        console.warn("[preload] Failed to get server URLs via IPC:", e);
    }
}
// Final fallback to defaults
if (!serverApiUrl)
    serverApiUrl = "http://127.0.0.1:3333";
if (!serverWsUrl)
    serverWsUrl = "ws://127.0.0.1:3333";
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
// Type declaration for renderer is in src/types/electron.d.ts
