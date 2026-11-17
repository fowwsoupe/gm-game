import type {
  CapCharge,
  DraftProspect,
  GameDate,
  FreeAgentOffer,
  GoalieRotation,
  GameResult,
  LeagueEvent,
  PlayoffSeries,
  Player,
  PlayerId,
  SpecialUnit,
  ScheduledGame,
  Sport,
  Team,
  TeamId,
  TeamStatus,
  TradeOffer,
} from '@gm/shared';

export type { ScheduledGame };

/**
 * The whole league as plain data, held in memory while a save is open.
 * The data layer loads it from SQLite and persists changes; the sim only ever reads it
 * and returns events. State changes happen in exactly one place: `applyEvent` (reducer).
 *
 * Keep it serializable (no classes, no functions): it crosses into the sim worker.
 */
export interface LeagueState {
  sport: Sport;
  rulesetId: string;
  date: GameDate;
  /** Seeded RNG position, so the next sim continues exactly where the last stopped. */
  rngState: number;
  teams: Record<TeamId, Team>;
  players: Record<string, Player>;
  teamStatus: Record<TeamId, TeamStatus>;
  schedule: ScheduledGame[];
  /** Results of the current season only; older seasons are archived by the data layer. */
  results: Record<string, GameResult>;
  playoffSeries: Record<string, PlayoffSeries>;
  championTeamId: TeamId | null;
  /** Dead cap (buyouts) for this season and later ones. Older seasons are dropped. */
  capCharges: CapCharge[];
  /** The offseason free-agency window is open (after `offseason.openFreeAgency`, until the next season starts). */
  freeAgencyOpen: boolean;
  /** Next draft's class, announced when the champion is crowned; drafted players leave it. */
  draftClass: DraftProspect[];
  /** Each team's ranked wish list for the draft. */
  draftBoards: Record<string, string[]>;
  /** Each human team's depth order for its lines, best first (absent = by rating). */
  depthCharts: Record<string, string[]>;
  /** Each human team's saved power-play / penalty-kill units (absent = auto). */
  specialUnits: Record<string, Partial<Record<SpecialUnit, PlayerId[]>>>;
  /** Owners of traded draft picks, by pick id (`season-round-originalTeam`). Untraded picks are absent. */
  pickOwners: Record<string, TeamId>;
  /** AI GMs' open offers to human teams. */
  tradeOffers: TradeOffer[];
  /** Open offers to free agents (AI teams' and yours); a free agent picks one the next day. */
  faOffers: FreeAgentOffer[];
  /** Players human teams listed as available: AI GMs make offers for them more often. */
  tradeBlock: PlayerId[];
  /** Teams that changed how their goalies share starts; absent = back-to-backs only. */
  goalieRotation: Record<TeamId, GoalieRotation>;
  /** Unsigned free agents whose contract just ran out: the team he left (loyalty may bring him back). */
  formerTeams: Record<PlayerId, TeamId>;
  /** Unsigned restricted free agents: the team that holds his rights (until he signs or the season starts). */
  rfaRights: Record<PlayerId, TeamId>;
  /** Offer sheets waiting for a human rights team's answer; no answer by the next day declines. */
  rfaSheets: FreeAgentOffer[];
  /** Players on human teams who asked to be traded (cleared by a talk that works or a trade). */
  tradeRequests: { playerId: PlayerId; teamId: TeamId }[];
  /** Count of events applied so far; the next event's id is built from it. */
  eventSeq: number;
}

/**
 * The single reducer: how each event changes state. Pure and synchronous.
 * Replaying the same events on the same starting state gives the same league.
 */
/** The season a move counts for: next season once the champion is crowned. */
const moveSeason = (state: LeagueState) => state.date.season + (state.championTeamId ? 1 : 0);

/** His trade request is settled: withdrawn, or he left the team (it would block new ones). */
const endRequest = (state: LeagueState, playerId: string) => {
  state.tradeRequests = state.tradeRequests.filter((r) => r.playerId !== playerId);
};

export function applyEvent(state: LeagueState, event: LeagueEvent): void {
  // Every applied event advances the sequence, in every copy of the state, so ids stay in sync.
  state.eventSeq++;
  switch (event.kind) {
    case 'clock.advanced':
      state.date = event.to;
      state.rngState = event.rngState;
      return;
    case 'team.planChanged': {
      const team = state.teams[event.teamId];
      if (team) team.plan = event.plan;
      return;
    }
    case 'team.gmChanged': {
      const team = state.teams[event.teamId];
      if (team) team.gm = event.gm;
      return;
    }
    case 'team.controlChanged': {
      const team = state.teams[event.teamId];
      if (team) team.userControlled = event.userControlled;
      return;
    }
    case 'game.final':
      state.results[event.result.id] = event.result;
      if (event.result.playoffSeriesId) {
        const series = state.playoffSeries[event.result.playoffSeriesId];
        if (!series) throw new Error(`unknown playoff series ${event.result.playoffSeriesId}`);
        const winner =
          event.result.homeScore > event.result.awayScore
            ? event.result.homeTeamId
            : event.result.awayTeamId;
        if (winner === series.higherTeamId) series.higherWins++;
        else if (winner === series.lowerTeamId) series.lowerWins++;
        else throw new Error('playoff winner not in series');
      }
      return;
    case 'series.started':
      state.playoffSeries[event.series.id] = { ...event.series };
      return;
    case 'series.won':
      state.playoffSeries[event.seriesId]!.winnerTeamId = event.winnerTeamId;
      return;
    case 'champion.crowned':
      state.championTeamId = event.championTeamId;
      return;
    case 'players.developed':
      for (const c of event.changes) {
        const p = state.players[c.playerId];
        if (!p) throw new Error(`unknown player ${c.playerId}`);
        p.ratings = { ...c.ratings };
        p.potential = c.potential;
      }
      return;
    case 'player.injured': {
      const p = state.players[event.playerId];
      if (!p) throw new Error(`unknown player ${event.playerId}`);
      p.injuredUntil = event.until;
      return;
    }
    case 'contract.boughtOut': {
      const p = state.players[event.playerId];
      if (!p) throw new Error(`unknown player ${event.playerId}`);
      p.teamId = null;
      delete p.contract;
      delete p.extension;
      delete p.joined;
      state.capCharges.push(...event.charges.map((c) => ({ ...c })));
      endRequest(state, p.id);
      return;
    }
    case 'player.retired':
      delete state.players[event.playerId];
      endRequest(state, event.playerId);
      return;
    case 'contract.expired': {
      const p = state.players[event.playerId];
      if (!p) throw new Error(`unknown player ${event.playerId}`);
      // `joined` stays: if his team re-signs him (`staying`), his time there carries on.
      const formerTeam = p.teamId;
      p.teamId = null;
      delete p.contract;
      delete p.extension;
      if (event.rightsTeamId) state.rfaRights[p.id] = event.rightsTeamId;
      if (formerTeam) state.formerTeams[p.id] = formerTeam;
      endRequest(state, p.id);
      return;
    }
    case 'player.drafted':
      state.players[event.player.id] = structuredClone(event.player);
      if (event.player.teamId) state.players[event.player.id]!.joined = moveSeason(state);
      state.draftClass = state.draftClass.filter((d) => d.player.id !== event.player.id);
      return;
    case 'draft.classAnnounced':
      state.draftClass = structuredClone(event.prospects);
      return;
    case 'draft.boardSet':
      state.draftBoards[event.teamId] = [...event.order];
      return;
    case 'player.tradeRequested':
      state.tradeRequests.push({ playerId: event.playerId, teamId: event.teamId });
      return;
    case 'player.tradeRequestEnded':
      endRequest(state, event.playerId);
      return;
    case 'trade.offered':
      state.tradeOffers.push(structuredClone(event.offer));
      return;
    case 'trade.offerClosed':
      state.tradeOffers = state.tradeOffers.filter((o) => o.id !== event.offerId);
      return;
    case 'lines.set':
      state.depthCharts[event.teamId] = [...event.order];
      return;
    case 'trade.blockSet':
      state.tradeBlock = state.tradeBlock.filter((id) => id !== event.playerId);
      if (event.onBlock) state.tradeBlock.push(event.playerId);
      return;
    case 'goalies.rotationSet':
      state.goalieRotation[event.teamId] = event.rotation;
      return;
    case 'units.set': {
      const mine = (state.specialUnits[event.teamId] ??= {});
      if (event.playerIds.length) mine[event.unit] = [...event.playerIds];
      else delete mine[event.unit];
      return;
    }
    case 'player.signed': {
      const p = state.players[event.playerId];
      if (!p) throw new Error(`unknown player ${event.playerId}`);
      if (p.teamId !== event.teamId && !event.staying) p.joined = moveSeason(state);
      p.teamId = event.teamId;
      p.contract = { ...event.contract };
      delete p.extension;
      delete state.rfaRights[p.id];
      delete state.formerTeams[p.id];
      state.rfaSheets = state.rfaSheets.filter((o) => o.playerId !== p.id);
      state.faOffers = state.faOffers.filter((o) => o.playerId !== event.playerId);
      return;
    }
    case 'freeAgency.sheetReceived':
      state.faOffers = state.faOffers.filter((o) => o.playerId !== event.offer.playerId);
      state.rfaSheets = state.rfaSheets.filter((o) => o.playerId !== event.offer.playerId);
      state.rfaSheets.push({ ...event.offer });
      return;
    case 'freeAgency.sheetDropped':
      state.rfaSheets = state.rfaSheets.filter((o) => o.playerId !== event.playerId);
      return;
    case 'freeAgency.offered':
      state.faOffers = state.faOffers.filter(
        (o) => o.playerId !== event.offer.playerId || o.teamId !== event.offer.teamId,
      );
      state.faOffers.push({ ...event.offer });
      return;
    case 'contract.extended': {
      const p = state.players[event.playerId];
      if (!p) throw new Error(`unknown player ${event.playerId}`);
      p.extension = { ...event.contract };
      return;
    }
    case 'season.started':
      state.date = { season: event.season, day: 0 };
      state.rngState = event.rngState;
      state.schedule = event.schedule.map((g) => ({ ...g, date: { ...g.date } }));
      state.results = {};
      for (const p of Object.values(state.players)) delete p.injuredUntil;
      state.playoffSeries = {};
      state.championTeamId = null;
      state.capCharges = state.capCharges.filter((c) => c.season >= event.season);
      state.freeAgencyOpen = false;
      state.draftClass = [];
      state.draftBoards = {};
      state.tradeOffers = [];
      state.faOffers = [];
      state.rfaRights = {};
      state.formerTeams = {};
      state.rfaSheets = [];
      // This season's draft is done: only later drafts' picks still matter.
      for (const id of Object.keys(state.pickOwners)) {
        if (Number(id.split('-')[0]) <= event.season) delete state.pickOwners[id];
      }
      return;
    case 'freeAgency.opened':
      state.freeAgencyOpen = true;
      return;
    case 'team.statusChanged':
      state.teamStatus[event.teamId] = event.to;
      return;
    case 'trade.completed': {
      const gone = new Set([...event.give, ...event.get]);
      state.tradeBlock = state.tradeBlock.filter((id) => !gone.has(id));
      const move = (ids: readonly string[], to: TeamId) => {
        for (const id of ids) {
          const p = state.players[id];
          if (!p) throw new Error(`unknown player ${id}`);
          p.teamId = to;
          p.joined = moveSeason(state);
        }
      };
      move(event.give, event.toTeamId);
      move(event.get, event.fromTeamId);
      // A traded player got his wish.
      state.tradeRequests = state.tradeRequests.filter(
        (r) =>
          !(event.give as string[]).includes(r.playerId) &&
          !(event.get as string[]).includes(r.playerId),
      );
      for (const id of event.givePicks ?? []) state.pickOwners[id] = event.toTeamId;
      for (const id of event.getPicks ?? []) state.pickOwners[id] = event.fromTeamId;
      for (const r of event.retained ?? []) {
        const p = state.players[r.playerId]!;
        if (p.contract) p.contract = { ...p.contract, capHit: r.capHit };
        state.capCharges.push(...r.charges.map((c) => ({ ...c })));
      }
      return;
    }
    case 'award.given':
    case 'stats.archived':
    case 'season.phaseChanged':
    case 'news.posted':
      return; // informational; no state change
    default: {
      const unhandled: never = event;
      throw new Error(`applyEvent: unhandled event ${(unhandled as LeagueEvent).kind}`);
    }
  }
}
