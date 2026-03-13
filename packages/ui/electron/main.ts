/**
 * Electron Main Process
 * 
 * Handles:
 * - Window management
 * - IPC with renderer
 * - Native integrations (PTY, file system)
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============ IPC Handlers ============

// Adapter management
ipcMain.handle('adapter:connect', async (_event, adapterId: string, config: unknown) => {
  // TODO: Implement adapter connection
  console.log('Connecting adapter:', adapterId, config);
  return { ok: true };
});

ipcMain.handle('adapter:disconnect', async (_event, adapterId: string) => {
  // TODO: Implement adapter disconnection
  console.log('Disconnecting adapter:', adapterId);
  return { ok: true };
});

ipcMain.handle('adapter:send', async (_event, adapterId: string, message: string) => {
  // TODO: Send message to adapter
  console.log('Sending to adapter:', adapterId, message);
  return { ok: true, turnId: crypto.randomUUID() };
});

// Launchers
ipcMain.handle('launcher:cursor', async (_event, path: string) => {
  const { exec } = await import('child_process');
  return new Promise((resolve, reject) => {
    exec(`cursor "${path}"`, (error) => {
      if (error) reject(error);
      else resolve({ ok: true });
    });
  });
});

ipcMain.handle('launcher:browser', async (_event, url: string) => {
  const { shell } = await import('electron');
  await shell.openExternal(url);
  return { ok: true };
});

// CodeRabbit CLI
ipcMain.handle('coderabbit:review', async (_event, cwd: string) => {
  const { exec } = await import('child_process');
  return new Promise((resolve, reject) => {
    exec('cr --prompt-only', { cwd }, (error, stdout, stderr) => {
      if (error) reject({ error: error.message, stderr });
      else resolve({ ok: true, output: stdout });
    });
  });
});

// GitHub CLI
ipcMain.handle('github:createPr', async (_event, options: { title: string; body: string; cwd: string }) => {
  const { exec } = await import('child_process');
  return new Promise((resolve, reject) => {
    exec(
      `gh pr create --title "${options.title}" --body "${options.body}"`,
      { cwd: options.cwd },
      (error, stdout, stderr) => {
        if (error) reject({ error: error.message, stderr });
        else resolve({ ok: true, output: stdout });
      }
    );
  });
});

// Dialog: Open Folder
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Project Folder',
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  
  return result.filePaths[0];
});
