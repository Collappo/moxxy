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
import { DeskStore } from './desks';

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
      preload: path.join(__dirname, '..', 'preload', 'index.mjs'),
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
  const desks = new DeskStore();
  // If there's an active desk, prime the supervisor with its cwd
  // BEFORE the run loop starts so the first spawn lands in the right
  // directory.
  const initialActive = await desks.getActive();
  if (initialActive) await supervisor.setCwd(initialActive.cwd);
  registerIpcHandlers(supervisor, desks);
  void supervisor.run();

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let isQuitting = false;
app.on('before-quit', (event) => {
  // Electron does NOT await the before-quit handler; if we just
  // returned a Promise, the process would exit before stop() landed
  // and the child runner would survive as a zombie. Trap the first
  // quit, run cleanup, then fire app.exit() explicitly.
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  void shutdown().finally(() => app.exit(0));
});

async function shutdown(): Promise<void> {
  if (!supervisor) return;
  await Promise.race([
    supervisor.stop().catch(() => undefined),
    // Belt-and-braces timeout: don't hang the app on a stuck child.
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);
}
