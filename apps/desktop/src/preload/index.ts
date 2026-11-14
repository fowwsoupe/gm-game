import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type GmApi } from '@gm/shared/ipc';

/** Exposes exactly GmApi to the UI as `window.gm`. Nothing else from Node leaks through. */
const api: GmApi = {
  app: {
    version: () => ipcRenderer.invoke(IPC.appVersion),
  },
  league: {
    newLeague: (input) => ipcRenderer.invoke(IPC.newLeague, input),
    listTeams: () => ipcRenderer.invoke(IPC.listTeams),
    standings: () => ipcRenderer.invoke(IPC.standings),
  },
  sim: {
    simDays: (input) => ipcRenderer.invoke(IPC.simDays, input),
  },
  steam: {
    status: () => ipcRenderer.invoke(IPC.steamStatus),
  },
};

contextBridge.exposeInMainWorld('gm', api);
