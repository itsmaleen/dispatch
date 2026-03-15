"use strict";
/**
 * Electron Preload Script
 *
 * Exposes safe APIs to the renderer process via contextBridge.
 *
 * T3 Code Pattern:
 * - Server URLs are set by main process BEFORE window is created
 * - Available via env vars or sync IPC fallback
 * - Listen for server-info events for dynamic updates (e.g., server restart)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Server URLs - get from main process via sync IPC (most reliable)
let serverApiUrl = "";
let serverWsUrl = "";
let serverPort = 0;
try {
    const info = electron_1.ipcRenderer.sendSync("server:get-urls");
    if (info && typeof info === 'object') {
        serverApiUrl = info.apiUrl || "";
        serverWsUrl = info.wsUrl || "";
        serverPort = parseInt(new URL(serverApiUrl).port) || 0;
    }
}
catch (e) {
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
electron_1.ipcRenderer.on("server-info", (_event, info) => {
    console.log("[preload] Server info updated:", info);
    if (info.apiUrl)
        serverApiUrl = info.apiUrl;
    if (info.wsUrl)
        serverWsUrl = info.wsUrl;
    if (info.port)
        serverPort = info.port;
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
