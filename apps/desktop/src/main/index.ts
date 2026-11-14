import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC } from '@gm/shared/ipc';
import type { Command, Importance } from '@gm/shared';
import { LeagueService } from './league';
import { initSteam, steamStatus } from './steam';

// Steam must initialize before any window is created for the overlay to hook in.
initSteam();

// Keep the sim running when the window loses focus (Electron throttles background windows).
const league = new LeagueService();

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0f17',
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  // Security: the game only ever loads local files (or the Vite dev server).
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function registerIpc() {
  ipcMain.handle(IPC.appVersion, () => app.getVersion());
  ipcMain.handle(IPC.newLeague, (_e, input: { seed: number }) => league.newLeague(input.seed));
  ipcMain.handle(IPC.listTeams, () => league.listTeams());
  ipcMain.handle(IPC.standings, () => league.standings());
  ipcMain.handle(IPC.feedList, (_e, input: { limit: number; minImportance?: Importance }) =>
    league.feed(input.limit, input.minImportance),
  );
  ipcMain.handle(IPC.dispatch, (_e, command: Command) => league.dispatch(command));
  ipcMain.handle(IPC.steamStatus, () => steamStatus());
}

void app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  league.dispose();
  app.quit();
});
