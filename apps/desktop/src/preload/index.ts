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
    international: () => ipcRenderer.invoke(IPC.international),
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
    staffCandidates: (input) => ipcRenderer.invoke(IPC.staffCandidates, input),
    departmentReturns: (input) => ipcRenderer.invoke(IPC.departmentReturns, input),
    ownerReport: (input) => ipcRenderer.invoke(IPC.ownerReport, input),
    evaluateTrade: (input) => ipcRenderer.invoke(IPC.evaluateTrade, input),
    status: () => ipcRenderer.invoke(IPC.status),
    pulse: () => ipcRenderer.invoke(IPC.pulse),
    dashboard: (input) => ipcRenderer.invoke(IPC.dashboard, input),
    draftClass: (input) => ipcRenderer.invoke(IPC.draftClass, input),
    prospects: (input) => ipcRenderer.invoke(IPC.prospects, input),
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
  session: {
    host: (input) => ipcRenderer.invoke(IPC.sessionHost, input),
    join: (input) => ipcRenderer.invoke(IPC.sessionJoin, input),
    leave: () => ipcRenderer.invoke(IPC.sessionLeave),
    requestSeat: (input) => ipcRenderer.invoke(IPC.sessionRequestSeat, input),
    seat: (input) => ipcRenderer.invoke(IPC.sessionSeat, input),
    ready: (input) => ipcRenderer.invoke(IPC.sessionReady, input),
    grantAdvance: (input) => ipcRenderer.invoke(IPC.sessionGrantAdvance, input),
    kick: (input) => ipcRenderer.invoke(IPC.sessionKick, input),
    status: () => ipcRenderer.invoke(IPC.sessionStatus),
    onChanged: (listener) => {
      // A signal with nothing in it: the listener is not handed the IPC event.
      const heard = () => listener();
      ipcRenderer.on(IPC.sessionChanged, heard);
      return () => {
        ipcRenderer.removeListener(IPC.sessionChanged, heard);
      };
    },
  },
};

contextBridge.exposeInMainWorld('gm', api);
