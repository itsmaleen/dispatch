"use strict";
/**
 * Electron Main Process
 *
 * Handles:
 * - Window management
 * - IPC with renderer
 * - Native integrations (PTY, file system)
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
let mainWindow = null;
const isDev = process.env.NODE_ENV === 'development';
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 600,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path_1.default.join(__dirname, 'preload.js'),
        },
    });
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../dist/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
// ============ IPC Handlers ============
// Adapter management
electron_1.ipcMain.handle('adapter:connect', async (_event, adapterId, config) => {
    // TODO: Implement adapter connection
    console.log('Connecting adapter:', adapterId, config);
    return { ok: true };
});
electron_1.ipcMain.handle('adapter:disconnect', async (_event, adapterId) => {
    // TODO: Implement adapter disconnection
    console.log('Disconnecting adapter:', adapterId);
    return { ok: true };
});
electron_1.ipcMain.handle('adapter:send', async (_event, adapterId, message) => {
    // TODO: Send message to adapter
    console.log('Sending to adapter:', adapterId, message);
    return { ok: true, turnId: crypto.randomUUID() };
});
// Launchers
electron_1.ipcMain.handle('launcher:cursor', async (_event, path) => {
    const { exec } = await Promise.resolve().then(() => __importStar(require('child_process')));
    return new Promise((resolve, reject) => {
        exec(`cursor "${path}"`, (error) => {
            if (error)
                reject(error);
            else
                resolve({ ok: true });
        });
    });
});
electron_1.ipcMain.handle('launcher:browser', async (_event, url) => {
    const { shell } = await Promise.resolve().then(() => __importStar(require('electron')));
    await shell.openExternal(url);
    return { ok: true };
});
// CodeRabbit CLI
electron_1.ipcMain.handle('coderabbit:review', async (_event, cwd) => {
    const { exec } = await Promise.resolve().then(() => __importStar(require('child_process')));
    return new Promise((resolve, reject) => {
        exec('cr --prompt-only', { cwd }, (error, stdout, stderr) => {
            if (error)
                reject({ error: error.message, stderr });
            else
                resolve({ ok: true, output: stdout });
        });
    });
});
// GitHub CLI
electron_1.ipcMain.handle('github:createPr', async (_event, options) => {
    const { exec } = await Promise.resolve().then(() => __importStar(require('child_process')));
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
electron_1.ipcMain.handle('dialog:openFolder', async () => {
    const result = await electron_1.dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Project Folder',
    });
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }
    return result.filePaths[0];
});
