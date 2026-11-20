import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC, type GmApi } from '@gm/shared/ipc';
import { LeagueService } from './league';
import { initSteam, steamStatus } from './steam';

// Steam must initialize before any window is created for the overlay to hook in.
initSteam();

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
      backgroundThrottling: false, // keep the UI live when the window loses focus
    },
  });
  win.once('ready-to-show', () => win.show());

  // Security: the game only ever loads local files (or the Vite dev server).
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

/** A league query's input, as the renderer sends it. */
type In<K extends keyof GmApi['league']> = Parameters<GmApi['league'][K]>[0];

function registerIpc() {
  ipcMain.handle(IPC.newLeague, (_e, input: In<'newLeague'>) => league.newLeague(input.seed));
  ipcMain.handle(IPC.newLeagueFromRoster, async (e, input: In<'newLeagueFromRoster'>) => {
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
  ipcMain.handle(IPC.international, () => league.international());
  ipcMain.handle(IPC.records, () => league.records());
  ipcMain.handle(IPC.leaders, () => league.leaders());
  ipcMain.handle(IPC.capSheet, (_e, input: In<'capSheet'>) => league.capSheet(input.teamId));
  ipcMain.handle(IPC.games, (_e, input: In<'games'>) => league.games(input.teamId, input.limit));
  ipcMain.handle(IPC.game, (_e, input: In<'game'>) => league.game(input.id));
  ipcMain.handle(IPC.exhibition, (_e, input: In<'exhibition'>) =>
    league.exhibition(input.homeTeamId, input.awayTeamId, input.seed),
  );
  ipcMain.handle(IPC.roster, (_e, input: In<'roster'>) => league.roster(input.teamId));
  ipcMain.handle(IPC.resignOffers, (_e, input: In<'resignOffers'>) =>
    league.resignOffers(input.teamId),
  );
  ipcMain.handle(IPC.players, (_e, input: In<'players'>) =>
    league.players(input.teamId, input.viewer),
  );
  ipcMain.handle(IPC.evaluateTrade, (_e, input: In<'evaluateTrade'>) =>
    league.evaluateTrade(input),
  );
  ipcMain.handle(IPC.status, () => league.status());
  ipcMain.handle(IPC.tradeRequests, (_e, input: In<'tradeRequests'>) =>
    league.tradeRequests(input.teamId),
  );
  ipcMain.handle(IPC.owner, (_e, input: In<'owner'>) => league.owner(input.teamId));
  ipcMain.handle(IPC.staffCandidates, (_e, input: In<'staffCandidates'>) =>
    league.staffCandidates(input.teamId),
  );
  ipcMain.handle(IPC.departmentReturns, (_e, input: In<'departmentReturns'>) =>
    league.departmentReturns(input.teamId),
  );
  ipcMain.handle(IPC.ownerReport, (_e, input: In<'ownerReport'>) =>
    league.ownerReport(input.teamId),
  );
  ipcMain.handle(IPC.offerSheets, (_e, input: In<'offerSheets'>) =>
    league.offerSheets(input.teamId),
  );
  ipcMain.handle(IPC.tradeOffers, (_e, input: In<'tradeOffers'>) =>
    league.tradeOffers(input.teamId),
  );
  ipcMain.handle(IPC.picks, (_e, input: In<'picks'>) => league.picks(input.teamId));
  ipcMain.handle(IPC.lines, (_e, input: In<'lines'>) => league.lines(input.teamId));
  ipcMain.handle(IPC.history, (_e, input: In<'history'>) => league.history(input.playerId));
  ipcMain.handle(IPC.career, (_e, input: In<'career'>) => league.career(input.playerId));
  ipcMain.handle(IPC.pulse, () => league.pulse());
  ipcMain.handle(IPC.dashboard, (_e, input: In<'dashboard'>) => league.dashboard(input.teamId));
  ipcMain.handle(IPC.draftClass, (_e, input: In<'draftClass'>) => league.draftClass(input.teamId));
  ipcMain.handle(IPC.prospects, (_e, input: In<'prospects'>) =>
    league.prospects(input.teamId, input.by),
  );
  ipcMain.handle(IPC.signingInterest, (_e, input: In<'signingInterest'>) =>
    league.signingInterest(input),
  );
  ipcMain.handle(IPC.feedList, (_e, input: Parameters<GmApi['feed']['list']>[0]) =>
    league.feed(input.limit, input.minImportance),
  );
  ipcMain.handle(IPC.dispatch, (_e, command: unknown) => league.dispatch(command));
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
