import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type GmApi } from '@gm/shared/ipc';

/** Exposes exactly GmApi to the UI as `window.gm`. Nothing else from Node leaks through. */
const api: GmApi = {
  app: {
    version: () => ipcRenderer.invoke(IPC.appVersion),
  },
  league: {
    newLeague: (input) => ipcRenderer.invoke(IPC.newLeague, input),
    newLeagueFromRoster: (input) => ipcRenderer.invoke(IPC.newLeagueFromRoster, input),
    listTeams: () => ipcRenderer.invoke(IPC.listTeams),
    standings: () => ipcRenderer.invoke(IPC.standings),
    playoffs: () => ipcRenderer.invoke(IPC.playoffs),
    awards: () => ipcRenderer.invoke(IPC.awards),
    records: () => ipcRenderer.invoke(IPC.records),
    leaders: () => ipcRenderer.invoke(IPC.leaders),
    capSheet: (input) => ipcRenderer.invoke(IPC.capSheet, input),
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
