"use strict";
/**
 * Electron Preload Script
 *
 * Exposes safe APIs to the renderer process via contextBridge
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // Adapter operations
    adapter: {
        connect: (adapterId, config) => electron_1.ipcRenderer.invoke('adapter:connect', adapterId, config),
        disconnect: (adapterId) => electron_1.ipcRenderer.invoke('adapter:disconnect', adapterId),
        send: (adapterId, message) => electron_1.ipcRenderer.invoke('adapter:send', adapterId, message),
        onEvent: (callback) => {
            const handler = (_event, data) => callback(data);
            electron_1.ipcRenderer.on('adapter:event', handler);
            return () => electron_1.ipcRenderer.removeListener('adapter:event', handler);
        },
    },
    // Launchers
    launcher: {
        cursor: (path) => electron_1.ipcRenderer.invoke('launcher:cursor', path),
        browser: (url) => electron_1.ipcRenderer.invoke('launcher:browser', url),
    },
    // CodeRabbit
    coderabbit: {
        review: (cwd) => electron_1.ipcRenderer.invoke('coderabbit:review', cwd),
    },
    // GitHub
    github: {
        createPr: (options) => electron_1.ipcRenderer.invoke('github:createPr', options),
    },
    // System
    platform: process.platform,
    // Project
    openFolder: () => electron_1.ipcRenderer.invoke('dialog:openFolder'),
});
