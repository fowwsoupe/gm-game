import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type GmApi } from '@gm/shared/ipc';

/** Exposes exactly GmApi to the UI as `window.gm`. Nothing else from Node leaks through. */
const api: GmApi = {
  league: {
    newLeague: (input) => ipcRenderer.invoke(IPC.newLeague, input),
    newLeagueFromRoster: (input) => ipcRenderer.invoke(IPC.newLeagueFromRoster, input),
    listTeams: () => ipcRenderer.invoke(IPC.listTeams),
    standings: () => ipcRenderer.invoke(IPC.standings),
    playoffs: () => ipcRenderer.invoke(IPC.playoffs),
    awards: () => ipcRenderer.invoke(IPC.awards),
    hallOfFame: () => ipcRenderer.invoke(IPC.hallOfFame),
    records: () => ipcRenderer.invoke(IPC.records),
    leaders: () => ipcRenderer.invoke(IPC.leaders),
    capSheet: (input) => ipcRenderer.invoke(IPC.capSheet, input),
    games: (input) => ipcRenderer.invoke(IPC.games, input),
    game: (input) => ipcRenderer.invoke(IPC.game, input),
    exhibition: (input) => ipcRenderer.invoke(IPC.exhibition, input),
    roster: (input) => ipcRenderer.invoke(IPC.roster, input),
    resignOffers: (input) => ipcRenderer.invoke(IPC.resignOffers, input),
    players: (input) => ipcRenderer.invoke(IPC.players, input),
    history: (input) => ipcRenderer.invoke(IPC.history, input),
    career: (input) => ipcRenderer.invoke(IPC.career, input),
    lines: (input) => ipcRenderer.invoke(IPC.lines, input),
    picks: (input) => ipcRenderer.invoke(IPC.picks, input),
    offerSheets: (input) => ipcRenderer.invoke(IPC.offerSheets, input),
    tradeOffers: (input) => ipcRenderer.invoke(IPC.tradeOffers, input),
    tradeRequests: (input) => ipcRenderer.invoke(IPC.tradeRequests, input),
    owner: (input) => ipcRenderer.invoke(IPC.owner, input),
    ownerReport: (input) => ipcRenderer.invoke(IPC.ownerReport, input),
    evaluateTrade: (input) => ipcRenderer.invoke(IPC.evaluateTrade, input),
    status: () => ipcRenderer.invoke(IPC.status),
    pulse: () => ipcRenderer.invoke(IPC.pulse),
    dashboard: (input) => ipcRenderer.invoke(IPC.dashboard, input),
    draftClass: (input) => ipcRenderer.invoke(IPC.draftClass, input),
    signingInterest: (input) => ipcRenderer.invoke(IPC.signingInterest, input),
  },
  feed: {
    list: (input) => ipcRenderer.invoke(IPC.feedList, input),
  },
  commands: {
    dispatch: (command) => ipcRenderer.invoke(IPC.dispatch, command),
  },
  steam: {
    status: () => ipcRenderer.invoke(IPC.steamStatus),
  },
};

contextBridge.exposeInMainWorld('gm', api);
