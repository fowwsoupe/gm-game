import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC, type GmApi } from '@gm/shared/ipc';
import { LeagueService } from './league';
import { Online } from './net/online';
import { initSteam, steamClient, steamStatus } from './steam';

// Steam must initialize before any window is created for the overlay to hook in.
initSteam();

/** This machine's league and the hosted one it may be in: the handlers read whichever is active. */
const online = new Online(
  new LeagueService(),
  app.getVersion(),
  () => {
    for (const win of BrowserWindow.getAllWindows())
      if (!win.isDestroyed()) win.webContents.send(IPC.sessionChanged);
  },
  undefined,
  steamClient(),
);

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
type SessionIn<K extends keyof GmApi['session']> = Parameters<GmApi['session'][K]>[0];

function registerIpc() {
  // A new league and a roster load are this machine's own: refused while a session is open.
  ipcMain.handle(IPC.newLeague, (_e, input: In<'newLeague'>) =>
    online.alone().newLeague(input.seed),
  );
  ipcMain.handle(IPC.newLeagueFromRoster, async (e, input: In<'newLeagueFromRoster'>) => {
    online.alone();
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      filters: [{ name: 'Roster file', extensions: ['json'] }],
      properties: ['openFile' as const],
    };
    const pick = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const path = pick.filePaths[0];
    if (pick.canceled || !path) return { ok: 'canceled' as const };
    return online.alone().newLeagueFromRoster(input.seed, path);
  });
  ipcMain.handle(IPC.listTeams, () => online.league.listTeams());
  ipcMain.handle(IPC.standings, () => online.league.standings());
  ipcMain.handle(IPC.playoffs, () => online.league.playoffs());
  ipcMain.handle(IPC.awards, () => online.league.awards());
  ipcMain.handle(IPC.hallOfFame, () => online.league.hallOfFame());
  ipcMain.handle(IPC.international, () => online.league.international());
  ipcMain.handle(IPC.records, () => online.league.records());
  ipcMain.handle(IPC.leaders, () => online.league.leaders());
  ipcMain.handle(IPC.capSheet, (_e, input: In<'capSheet'>) => online.league.capSheet(input.teamId));
  ipcMain.handle(IPC.games, (_e, input: In<'games'>) =>
    online.league.games(input.teamId, input.limit),
  );
  ipcMain.handle(IPC.watch, (_e, input: In<'watch'>) => league.watch(input.teamId));
  ipcMain.handle(IPC.roster, (_e, input: In<'roster'>) => league.roster(input.teamId));
  ipcMain.handle(IPC.resignOffers, (_e, input: In<'resignOffers'>) =>
    online.league.resignOffers(input.teamId),
  );
  ipcMain.handle(IPC.players, (_e, input: In<'players'>) =>
    online.league.players(input.teamId, input.viewer),
  );
  ipcMain.handle(IPC.evaluateTrade, (_e, input: In<'evaluateTrade'>) =>
    online.league.evaluateTrade(input),
  );
  ipcMain.handle(IPC.status, () => online.league.status());
  ipcMain.handle(IPC.tradeRequests, (_e, input: In<'tradeRequests'>) =>
    online.league.tradeRequests(input.teamId),
  );
  ipcMain.handle(IPC.owner, (_e, input: In<'owner'>) => online.league.owner(input.teamId));
  ipcMain.handle(IPC.staffCandidates, (_e, input: In<'staffCandidates'>) =>
    online.league.staffCandidates(input.teamId),
  );
  ipcMain.handle(IPC.departmentReturns, (_e, input: In<'departmentReturns'>) =>
    online.league.departmentReturns(input.teamId),
  );
  ipcMain.handle(IPC.ownerReport, (_e, input: In<'ownerReport'>) =>
    online.league.ownerReport(input.teamId),
  );
  ipcMain.handle(IPC.offerSheets, (_e, input: In<'offerSheets'>) =>
    online.league.offerSheets(input.teamId),
  );
  ipcMain.handle(IPC.tradeOffers, (_e, input: In<'tradeOffers'>) =>
    online.league.tradeOffers(input.teamId),
  );
  ipcMain.handle(IPC.picks, (_e, input: In<'picks'>) => online.league.picks(input.teamId));
  ipcMain.handle(IPC.lines, (_e, input: In<'lines'>) => online.league.lines(input.teamId));
  ipcMain.handle(IPC.history, (_e, input: In<'history'>) => online.league.history(input.playerId));
  ipcMain.handle(IPC.career, (_e, input: In<'career'>) => online.league.career(input.playerId));
  ipcMain.handle(IPC.pulse, () => online.league.pulse());
  ipcMain.handle(IPC.dashboard, (_e, input: In<'dashboard'>) =>
    online.league.dashboard(input.teamId),
  );
  ipcMain.handle(IPC.draftClass, (_e, input: In<'draftClass'>) =>
    online.league.draftClass(input.teamId),
  );
  ipcMain.handle(IPC.prospects, (_e, input: In<'prospects'>) =>
    online.league.prospects(input.teamId, input.by),
  );
  ipcMain.handle(IPC.signingInterest, (_e, input: In<'signingInterest'>) =>
    online.league.signingInterest(input),
  );
  ipcMain.handle(IPC.feedList, (_e, input: Parameters<GmApi['feed']['list']>[0]) =>
    online.league.feed(input.limit, input.minImportance),
  );
  ipcMain.handle(IPC.dispatch, (_e, command: unknown) => online.dispatch(command));
  ipcMain.handle(IPC.steamStatus, () => steamStatus());
  ipcMain.handle(IPC.sessionHost, (_e, input: SessionIn<'host'>) => online.host(input));
  ipcMain.handle(IPC.sessionInvite, () => online.invite());
  ipcMain.handle(IPC.sessionJoin, (_e, input: SessionIn<'join'>) => online.join(input));
  ipcMain.handle(IPC.sessionLeave, () => online.leave());
  ipcMain.handle(IPC.sessionRequestSeat, (_e, input: SessionIn<'requestSeat'>) =>
    online.requestSeat(input),
  );
  ipcMain.handle(IPC.sessionSeat, (_e, input: SessionIn<'seat'>) => online.seat(input));
  ipcMain.handle(IPC.sessionReady, (_e, input: SessionIn<'ready'>) => online.ready(input));
  ipcMain.handle(IPC.sessionGrantAdvance, (_e, input: SessionIn<'grantAdvance'>) =>
    online.grantAdvance(input),
  );
  ipcMain.handle(IPC.sessionKick, (_e, input: SessionIn<'kick'>) => online.kick(input));
  ipcMain.handle(IPC.sessionStatus, () => online.status());
}

void app.whenReady().then(() => {
  registerIpc();
  createWindow();
  // An invite accepted while the game was not running: Steam starts it with the lobby to join.
  const lobby = process.argv[process.argv.indexOf('+connect_lobby') + 1];
  if (process.argv.includes('+connect_lobby') && lobby && /^\d{1,20}$/.test(lobby))
    void online.invited(BigInt(lobby));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  online.dispose();
  app.quit();
});
