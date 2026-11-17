import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC } from '@gm/shared/ipc';
import type { Command, Importance, TeamId, TradeProposal } from '@gm/shared';
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
  ipcMain.handle(IPC.newLeagueFromRoster, async (e, input: { seed: number }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      filters: [{ name: 'Roster file', extensions: ['json'] }],
      properties: ['openFile' as const],
    };
    const pick = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const path = pick.filePaths[0];
    if (pick.canceled || !path) return { ok: 'canceled' as const };
    return league.newLeagueFromRoster(input.seed, path);
  });
  ipcMain.handle(IPC.listTeams, () => league.listTeams());
  ipcMain.handle(IPC.standings, () => league.standings());
  ipcMain.handle(IPC.playoffs, () => league.playoffs());
  ipcMain.handle(IPC.awards, () => league.awards());
  ipcMain.handle(IPC.hallOfFame, () => league.hallOfFame());
  ipcMain.handle(IPC.records, () => league.records());
  ipcMain.handle(IPC.leaders, () => league.leaders());
  ipcMain.handle(IPC.capSheet, (_e, input: { teamId: TeamId }) => league.capSheet(input.teamId));
  ipcMain.handle(IPC.games, (_e, input: { teamId?: TeamId; limit: number }) =>
    league.games(input.teamId, input.limit),
  );
  ipcMain.handle(IPC.game, (_e, input: { id: string }) => league.game(input.id));
  ipcMain.handle(
    IPC.exhibition,
    (_e, input: { homeTeamId: TeamId; awayTeamId: TeamId; seed: number }) =>
      league.exhibition(input.homeTeamId, input.awayTeamId, input.seed),
  );
  ipcMain.handle(IPC.roster, (_e, input: { teamId: TeamId }) => league.roster(input.teamId));
  ipcMain.handle(IPC.resignOffers, (_e, input: { teamId: TeamId }) =>
    league.resignOffers(input.teamId),
  );
  ipcMain.handle(IPC.players, (_e, input: { teamId: TeamId | null }) =>
    league.players(input.teamId),
  );
  ipcMain.handle(IPC.evaluateTrade, (_e, input: TradeProposal) => league.evaluateTrade(input));
  ipcMain.handle(IPC.status, () => league.status());
  ipcMain.handle(IPC.tradeRequests, (_e, input: { teamId: TeamId }) =>
    league.tradeRequests(input.teamId),
  );
  ipcMain.handle(IPC.offerSheets, (_e, input: { teamId: TeamId }) =>
    league.offerSheets(input.teamId),
  );
  ipcMain.handle(IPC.tradeOffers, (_e, input: { teamId: TeamId }) =>
    league.tradeOffers(input.teamId),
  );
  ipcMain.handle(IPC.picks, (_e, input: { teamId: TeamId }) => league.picks(input.teamId));
  ipcMain.handle(IPC.lines, (_e, input: { teamId: TeamId }) => league.lines(input.teamId));
  ipcMain.handle(IPC.history, (_e, input: { playerId: string }) => league.history(input.playerId));
  ipcMain.handle(IPC.career, (_e, input: { playerId: string }) => league.career(input.playerId));
  ipcMain.handle(IPC.pulse, () => league.pulse());
  ipcMain.handle(IPC.dashboard, (_e, input: { teamId: TeamId }) => league.dashboard(input.teamId));
  ipcMain.handle(IPC.draftClass, (_e, input: { teamId: TeamId }) =>
    league.draftClass(input.teamId),
  );
  ipcMain.handle(
    IPC.signingInterest,
    (
      _e,
      input: { playerId: string; teamId: TeamId; salary: number; years: number; noTrade?: true },
    ) => league.signingInterest(input.playerId, input.teamId, input),
  );
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
