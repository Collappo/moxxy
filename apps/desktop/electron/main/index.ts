/**
 * Electron entry point. Owns the lifecycle of:
 *
 *   - the main window (single, for now — multi-window is deferred)
 *   - the [`RunnerSupervisor`] (started before the window opens; the
 *     supervisor's first `connection.changed` event lands at the
 *     renderer the moment the preload bridge is ready)
 *   - the IPC wiring
 */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RunnerSupervisor } from './runner-supervisor';
import { bindWindow, registerIpcHandlers } from './ipc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

let supervisor: RunnerSupervisor | null = null;
let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    title: 'moxxy',
    width: 1180,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#08080c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (isDev) {
    await mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  if (supervisor) {
    const unbind = bindWindow(supervisor, mainWindow);
    mainWindow.on('closed', () => {
      unbind();
      mainWindow = null;
    });
  }
}

app.whenReady().then(async () => {
  supervisor = new RunnerSupervisor();
  registerIpcHandlers(supervisor);
  // Kick the loop — runs in the background; the renderer's first
  // `connection.snapshot` invoke or `connection.changed` event will
  // describe whatever phase we're in.
  void supervisor.run();

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  if (supervisor) {
    await supervisor.stop().catch(() => undefined);
  }
});
