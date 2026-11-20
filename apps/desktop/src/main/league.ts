import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';
import { app } from 'electron';
import { openSave, type SaveFile } from '@gm/data';
import {
  HOCKEY_TUNING,
  applyEvent,
  available,
  capSheet,
  computeStandings,
  leagueStandings,
  createLeague,
  defaultContext,
  legendTrophies,
  MARKET_DAYS,
  phaseOf,
  parseXgTable,
  playerProfiles,
  chemistry,
  autoLineup,
  lineupFit,
  lineupTogether,
  seatsOf,
  fansOf,
  marketOf,
  coachOf,
  departmentsOf,
  staffOf,
  ownerOf,
  gmOf,
  ownerStanding,
  ticketPctOf,
  dashboard,
  raceNight,
  draftPicks,
  picksLeft,
  prospectsOf,
  playoffOdds,
  teamRatings,
  assistantGuess,
  evaluateTrade,
  scoutReport,
  teamRange,
  staffCandidates,
  departmentReturns,
  capYearOf,
  signingInterest,
  storyOf,
  tradeWindowOpen,
  playerRecords,
  resignOffers,
  Rng,
  teamRecords,
  type LeagueState,
  strengthFor,
} from '@gm/sim';
import type {
  Actor,
  Command,
  CommandResult,
  Department,
  GameDetail,
  GameId,
  GameResult,
  GameSummary,
  HallOfFamer,
  Importance,
  LeagueEvent,
  LeagueStatus,
  OwnerReport,
  Player,
  PlayerId,
  ProspectEntry,
  PulseRow,
  RosterPlayer,
  StaffProfile,
  TableRows,
  TeamId,
  TradeProposal,
} from '@gm/shared';
import { parseCommand } from '@gm/shared';
import type { GmApi } from '@gm/shared/ipc';
import createSimWorker from './sim.worker?nodeWorker';
import type { WorkerRequest } from './sim.worker';
import { contextWithXg } from './simContext';

/** The team, or an error when the id is unknown. */
function teamIn(state: LeagueState, teamId: TeamId) {
  const team = state.teams[teamId];
  if (!team) throw new Error(`No team ${teamId}`);
  return team;
}

/** The human at this machine. A hosted league's guests get actors the host builds (`dispatch`). */
const LOCAL: Actor = { id: 'local', controls: [] };

/**
 * Owns the open save and the in-memory league state. The flow for every change:
 *   UI → commands.dispatch(cmd) → worker runs the sim → events
 *   → applyEvent on our copy → SaveFile.persist(events) → UI refetches.
 * Nothing else writes to the state or the save.
 */
export class LeagueService {
  private save: SaveFile | null = null;
  private state: LeagueState | null = null;
  /** Started by the first command: a guest's mirror never runs the sim. */
  private worker: Worker | null = null;
  /** Commands (and a mirror's batches of events) run one at a time, in order. */
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * Called after each batch of events is saved, with the event count before it and the actor its
   * command ran as (the one `dispatch` was given): a host sends the batch on from here. The events
   * are a copy from before they were applied, so a mirror is given exactly what this service's
   * reducer was given. It must not throw: the batch is already saved.
   */
  onPersisted?: (events: LeagueEvent[], seq: number, actor?: Actor) => void;
  /** A mirror runs no command: its session sets this, and `dispatch` sends the command to the host. */
  forward?: (command: Command) => Promise<CommandResult>;

  /**
   * `path`: the save file, the player's own by default. A guest's mirror passes ':memory:', so
   * his own save is never opened while he is a guest.
   */
  constructor(private readonly path?: string) {}

  /**
   * The user's shot-quality model, if `<userData>/models/xg.json` exists and is valid. An invalid
   * file is reported and ignored: the game never fails to start over a model file.
   */
  private xg: unknown = (() => {
    const path = join(app.getPath('userData'), 'models', 'xg.json');
    if (!existsSync(path)) return undefined;
    try {
      const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
      const parsed = parseXgTable(json);
      if (parsed.ok) return json;
      console.warn(`Ignoring ${path}: ${parsed.errors.join('; ')}`);
    } catch {
      console.warn(`Ignoring ${path}: not valid JSON`);
    }
    return undefined;
  })();

  /** The save file's path; the folder is created on the way (first run: there is none yet). */
  private savePath() {
    if (this.path) return this.path;
    const dir = join(app.getPath('userData'), 'saves');
    mkdirSync(dir, { recursive: true });
    return join(dir, 'league-1.sqlite');
  }

  private open(): { save: SaveFile; state: LeagueState } {
    if (!this.save) {
      this.save = openSave(this.savePath());
      if (this.save.getMeta('season')) this.state = this.save.loadState();
    }
    if (!this.state) throw new Error('No league yet. Start a new league first.');
    return { save: this.save, state: this.state };
  }

  newLeague(seed: number) {
    return this.start(createLeague(seed, defaultContext()));
  }

  /** Starts a league from a roster JSON file. Invalid files leave the current save alone. */
  newLeagueFromRoster(seed: number, path: string) {
    const ctx = defaultContext();
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return { ok: false as const, errors: ['This file is not valid JSON.'] };
    }
    const roster = ctx.sport.importRoster(json, ctx.ruleset);
    if (!roster.ok) return { ok: false as const, errors: roster.errors };
    return { ok: true as const, ...this.start(createLeague(seed, ctx, roster)) };
  }

  private start(state: LeagueState) {
    // Build the new save beside the old one and swap it in, so a crash never leaves no save.
    const fresh = `${this.savePath()}.new`;
    rmSync(fresh, { force: true });
    const next = openSave(fresh);
    next.saveNewLeague(state);
    next.close(); // checkpoints the WAL into the file, so the rename moves everything
    this.save?.close();
    this.save = null;
    for (const ext of ['', '-wal', '-shm']) rmSync(this.savePath() + ext, { force: true });
    renameSync(fresh, this.savePath());
    this.save = openSave(this.savePath());
    this.state = state;
    return { teams: this.save.listTeams() };
  }

  /** The league's rules and sport, and its event count: what a hosted session checks. */
  head() {
    const { state } = this.open();
    return { rulesetId: state.rulesetId, sport: state.sport, seq: state.eventSeq };
  }

  /** The whole save as rows and the event count they stand at: what a mirror is built from. */
  snapshot(): { seq: number; tables: TableRows[] } {
    const { save, state } = this.open();
    return { seq: state.eventSeq, tables: save.dumpRows() };
  }

  /**
   * A mirror's start, and its way back after a gap: a fresh in-memory save filled with a host's
   * rows (`snapshot`, with the rows per table), then the state loaded from it. A bad snapshot
   * throws and leaves the service as it was.
   */
  restore(tables: Iterable<TableRows>, counts: Readonly<Record<string, number>>) {
    // On the player's own save this would leave his file behind and play on in memory.
    if (this.path !== ':memory:') throw new Error('Only a mirror takes a snapshot.');
    const next = openSave(':memory:');
    try {
      next.restoreRows(tables, counts);
      this.state = next.loadState();
    } catch (err) {
      next.close();
      throw err;
    }
    this.save?.close();
    this.save = next;
  }

  listTeams() {
    return this.open().save.listTeams();
  }

  standings() {
    const { state } = this.open();
    return leagueStandings(state, defaultContext(state.rulesetId).ruleset);
  }

  playoffs() {
    const { state } = this.open();
    return { series: Object.values(state.playoffSeries), championTeamId: state.championTeamId };
  }

  awards() {
    const { save, state } = this.open();
    const trophies = legendTrophies(this.hallOfFame(), defaultContext(state.rulesetId));
    return save.listAwards().map((a) => {
      const t = trophies[a.award];
      return t && a.season >= t.from ? { ...a, trophy: t.surname } : a;
    });
  }

  international() {
    return [...this.open().state.international].reverse();
  }

  hallOfFame(): HallOfFamer[] {
    const { save, state } = this.open();
    const { sport } = defaultContext(state.rulesetId);
    const awards = new Map<string, string[]>();
    for (const a of save.listAwards()) {
      if (a.playerId) awards.set(a.playerId, [...(awards.get(a.playerId) ?? []), a.award]);
    }
    return save
      .retiredCareers()
      .flatMap((c) => {
        const won = awards.get(c.id) ?? [];
        const verdict = sport.hallOfFame({ position: c.position, seasons: c.lines, awards: won });
        return verdict.inducted
          ? [
              {
                playerId: c.id,
                name: c.name,
                position: c.position,
                retiredSeason: c.retiredSeason,
                seasons: c.lines.length,
                totals: verdict.totals,
                awards: won,
              },
            ]
          : [];
      })
      .sort((a, b) => b.retiredSeason - a.retiredSeason || a.name.localeCompare(b.name));
  }

  leaders() {
    const { state } = this.open();
    const results = Object.values(state.results).filter((g) => !g.playoffSeriesId);
    const boards = defaultContext(state.rulesetId).sport.leaders(
      results,
      Object.values(state.players),
      10,
    );
    return boards.map((b) => ({
      ...b,
      rows: b.rows.map((r) => ({
        ...r,
        age: state.date.season - state.players[r.playerId]!.birthYear,
      })),
    }));
  }

  records() {
    const { save, state } = this.open();
    const { ruleset, sport } = defaultContext(state.rulesetId);
    const teamIds = Object.keys(state.teams) as TeamId[];
    const played = save.finishedSeasons().map((season) => ({
      season,
      results: save.playedResults(season).filter((g) => !g.playoffSeriesId),
    }));
    const seasons = played.map(({ season, results }) => ({
      season,
      rows: computeStandings(teamIds, results, ruleset.season.points),
    }));
    const champions = save
      .listAwards()
      .filter((a) => a.award === 'champion')
      .map((a) => a.teamId);
    const everyone = save.listPlayers(true);
    const boards = played.map(({ season, results }) => ({
      season,
      boards: sport.leaders(results, everyone, 1),
    }));
    return [...teamRecords(seasons, champions), ...playerRecords(boards)];
  }

  /**
   * The cap year in play (next season once the champion is crowned, since expiring deals are
   * then off the books) and the seasons after it, as far as the longest possible contract.
   */
  capSheet(teamId: TeamId) {
    const { state } = this.open();
    const { ruleset } = defaultContext(state.rulesetId);
    const over = state.championTeamId !== null;
    return capSheet(ruleset, {
      teamId,
      players: Object.values(state.players),
      charges: state.capCharges,
      fromSeason: state.date.season + (over ? 1 : 0),
      years: ruleset.contracts.maxYearsResign,
      phase: over ? 'offseason' : phaseOf(ruleset.season.calendar, state.date),
    });
  }

  games(teamId: TeamId | undefined, limit: number): GameSummary[] {
    const { state } = this.open();
    return Object.values(state.results)
      .filter((g) => !teamId || g.homeTeamId === teamId || g.awayTeamId === teamId)
      .reverse() // results are stored in the order they were played
      .slice(0, Math.max(0, limit))
      .map((g) => ({
        id: g.id,
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        overtime: g.overtime,
        shootout: g.stats.shootout === 1,
      }));
  }

  game(id: string): GameDetail | null {
    const { state } = this.open();
    const result = state.results[id];
    return result ? this.detail(state, result) : null;
  }

  exhibition(homeTeamId: TeamId, awayTeamId: TeamId, seed: number): GameDetail {
    const { state } = this.open();
    if (!state.teams[homeTeamId] || !state.teams[awayTeamId] || homeTeamId === awayTeamId) {
      throw new Error('pick two different teams');
    }
    const ctx = contextWithXg(state.rulesetId, this.xg);
    const strength = (id: TeamId) =>
      strengthFor(state, ctx, id, available(state, id, state.date.day));
    const result = ctx.sport.simGame(
      {
        id: `x${seed}` as GameId,
        homeTeamId,
        awayTeamId,
        home: strength(homeTeamId),
        away: strength(awayTeamId),
      },
      new Rng(seed),
    );
    delete result.injuries; // nobody is hurt in an exhibition
    return this.detail(state, result);
  }

  private detail(state: LeagueState, result: GameResult): GameDetail {
    const names: Record<string, string> = {};
    const box = result.box as
      | {
          home: { skaters: { id: string }[]; goalie: { id: string }; relief?: { id: string } };
          away: unknown;
        }
      | undefined;
    const sides = box ? [box.home, box.away as typeof box.home] : [];
    for (const side of sides) {
      for (const { id } of [...side.skaters, side.goalie, ...(side.relief ? [side.relief] : [])]) {
        const p = state.players[id];
        if (p) names[id] = `${p.firstName} ${p.lastName}`;
      }
    }
    // Playoff overtime is played in full periods.
    const overtimeSeconds = result.playoffSeriesId ? 1200 : HOCKEY_TUNING.overtimeSeconds;
    return { result, names, overtimeSeconds };
  }

  /** Players on the team now, including ones whose contract ends this season. */
  roster(teamId: TeamId): RosterPlayer[] {
    return Object.values(this.open().state.players)
      .filter((p) => p.teamId === teamId)
      .map(({ id, firstName, lastName, position, contract }) => ({
        id,
        firstName,
        lastName,
        position,
        ...(contract && { contract }),
      }));
  }

  resignOffers(teamId: TeamId) {
    const { state } = this.open();
    return resignOffers(state, defaultContext(state.rulesetId), teamId);
  }

  players(teamId: TeamId | null, viewer?: TeamId) {
    const { state } = this.open();
    return playerProfiles(state, defaultContext(state.rulesetId), teamId, viewer);
  }

  evaluateTrade(proposal: TradeProposal) {
    const { state } = this.open();
    const ctx = defaultContext(state.rulesetId);
    const guess = assistantGuess(state, ctx, proposal);
    return {
      ...evaluateTrade(state, ctx, proposal),
      ...(guess !== undefined && { assistantGuess: guess }),
    };
  }

  status(): LeagueStatus {
    const { state } = this.open();
    const ctx = defaultContext(state.rulesetId);
    const cal = ctx.ruleset.season.calendar;
    return {
      season: state.date.season,
      day: state.date.day,
      phase: phaseOf(cal, state.date),
      championTeamId: state.championTeamId,
      freeAgencyOpen: state.freeAgencyOpen,
      draftLive: state.draftPicksMade !== null,
      tradeDeadlineDay: cal.tradeDeadlineDay,
      playoffsStartDay: cal.regularSeasonDays,
      playoffsEndDay: cal.regularSeasonDays + cal.playoffDays,
      tradesOpen: tradeWindowOpen(state, ctx),
      career: state.career,
      canBeFired: state.canBeFired,
      stopOn: state.stopOn,
      ...(state.freeAgencyOpen && { market: { day: state.marketDay, closing: MARKET_DAYS } }),
    };
  }

  tradeRequests(teamId: TeamId) {
    return this.open()
      .state.tradeRequests.filter((r) => r.teamId === teamId)
      .map((r) => r.playerId);
  }

  owner(teamId: TeamId) {
    const { state } = this.open();
    const team = teamIn(state, teamId);
    const { ruleset } = defaultContext(state.rulesetId);
    return {
      owner: ownerOf(team),
      gm: team.userControlled ? null : gmOf(team).name,
      coach: coachOf(team, ruleset.finance.coach, state.date.season),
      staff: Object.fromEntries(
        departmentsOf(team).map((d) => [
          d,
          staffOf(team, d, ruleset.frontOffice.salary, state.date.season),
        ]),
      ) as Record<Exclude<Department, 'assistant'>, StaffProfile> & { assistant?: StaffProfile },
      market: marketOf(team),
      capacity: seatsOf(state, teamId, ruleset),
      fans: fansOf(state, teamId),
      ticketPct: ticketPctOf(team, state.ticketPrices),
    };
  }

  departmentReturns(teamId: TeamId) {
    const { state } = this.open();
    teamIn(state, teamId);
    return departmentReturns(state, defaultContext(state.rulesetId), teamId);
  }

  staffCandidates(teamId: TeamId) {
    const { state } = this.open();
    const team = teamIn(state, teamId);
    const ctx = defaultContext(state.rulesetId);
    const season = capYearOf(state);
    const legends = this.hallOfFame();
    return Object.fromEntries(
      departmentsOf(team).map((d) => [
        d,
        {
          candidates: staffCandidates(team, d, ctx, season, legends),
          locked: team.staff?.[d]?.hired === season,
        },
      ]),
    ) as Partial<Record<Department, { candidates: StaffProfile[]; locked: boolean }>>;
  }

  ownerReport(teamId: TeamId): OwnerReport {
    const { save, state } = this.open();
    const team = teamIn(state, teamId);
    const { money, meetings } = save.ownerHistory(teamId);
    // Cash after each settlement, counted back from today's (so card payments land in it too).
    let cash = state.cash[teamId] ?? 0;
    const flow = money
      .reverse()
      .map((m) => {
        const point = { ...m, cash };
        cash -= m.revenue - m.costs;
        return point;
      })
      .reverse();
    return {
      owner: ownerOf(team),
      standing: ownerStanding(state, defaultContext(state.rulesetId), teamId),
      cash: state.cash[teamId] ?? 0,
      money: flow,
      meetings,
    };
  }

  offerSheets(teamId: TeamId) {
    const { state } = this.open();
    return state.rfaSheets.filter((o) => state.rfaRights[o.playerId] === teamId);
  }

  tradeOffers(teamId: TeamId) {
    return this.open().state.tradeOffers.filter((o) => o.proposal.toTeamId === teamId);
  }

  picks(teamId: TeamId) {
    const { state } = this.open();
    return draftPicks(state, defaultContext(state.rulesetId).ruleset, teamId);
  }

  lines(teamId: TeamId) {
    const { state } = this.open();
    const { sport } = defaultContext(state.rulesetId);
    const healthy = available(state, teamId, state.date.day);
    const depth = state.depthCharts[teamId];
    const lineup = autoLineup(healthy, depth);
    return {
      units: sport.lineup(healthy, depth),
      special: sport.specialUnits(healthy, depth, state.specialUnits[teamId]),
      chemistry: chemistry(healthy, state.date.season),
      fit: lineupFit(lineup),
      together: lineupTogether(lineup, state.linemates[teamId]),
      rotation: state.goalieRotation[teamId] ?? 'backToBack',
      disputes: state.disputes
        .filter((d) => d.teamId === teamId)
        .map((d) => ({
          playerId: d.playerId,
          ...(d.until !== undefined && { until: d.until }),
          ...(d.listed && { listed: true as const }),
        })),
    };
  }

  history(playerId: string) {
    return this.open().save.playerHistory(playerId);
  }

  career(playerId: string) {
    return this.open().save.careerLines(playerId);
  }

  dashboard(teamId: TeamId) {
    const { state } = this.open();
    const ctx = defaultContext(state.rulesetId);
    const home = dashboard(state, ctx, teamId);
    if (phaseOf(ctx.ruleset.season.calendar, state.date) !== 'regular') return home;
    const night = raceNight({
      teams: Object.values(state.teams),
      schedule: state.schedule,
      results: Object.values(state.results),
      ruleset: ctx.ruleset,
      season: state.date.season,
      exponent: ctx.sport.pythagoreanExponent,
      sims: 500,
      teamId,
      seed: state.rngState,
    });
    return night ? { ...home, raceNight: night } : home;
  }

  /** Odds from 1,000 runs of the rest of the season, seeded by the league so it is stable between refreshes. */
  pulse(): PulseRow[] {
    const { state } = this.open();
    const { ruleset, sport } = defaultContext(state.rulesetId);
    const teams = Object.values(state.teams);
    const results = Object.values(state.results);
    const odds = playoffOdds({
      teams,
      schedule: state.schedule,
      results,
      ruleset,
      season: state.date.season,
      exponent: sport.pythagoreanExponent,
      rng: new Rng(state.rngState),
      sims: 1000,
    });
    const rows = leagueStandings(state, ruleset);
    const rating = teamRatings(rows, sport.pythagoreanExponent);
    return teams.map((t) => ({
      teamId: t.id,
      playoffOdds: odds.get(t.id) ?? 0,
      rating: rating.get(t.id) ?? 0.5,
      status: state.teamStatus[t.id] ?? 'bubble',
    }));
  }

  draftClass(teamId: TeamId) {
    const { save, state } = this.open();
    const ctx = defaultContext(state.rulesetId);
    const latest = save.latestDraft();
    return {
      prospects: state.draftClass.map((pd) => {
        // Your scouting department's read, not the public range.
        const team = state.teams[teamId];
        const d = team ? { ...pd, ...teamRange(team, pd, ctx, state.date.season) } : pd;
        const { player: p, low, high } = d;
        return {
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          position: p.position,
          age: state.date.season + 1 - p.birthYear,
          low,
          high,
          report: scoutReport(ctx, d),
          ...(pd.line && { line: pd.line }),
        };
      }),
      board: state.draftBoards[teamId] ?? [],
      order: picksLeft(state, ctx),
      made: latest.picks,
      madeSeason: latest.season,
    };
  }

  /** `teamId`'s prospects, each range as `by`'s scouts read it (default: his own team's). */
  prospects(teamId: TeamId, by = teamId): ProspectEntry[] {
    const { state } = this.open();
    const team = state.teams[by];
    if (!team || !state.teams[teamId]) throw new Error(`No team ${teamId}`);
    const ctx = defaultContext(state.rulesetId);
    const season = state.date.season;
    return prospectsOf(state, teamId).map(({ player: p, league, rightsEnd, line }) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      position: p.position,
      age: season - p.birthYear,
      league: ctx.sport.prospectLeague(league, season - p.birthYear, ctx.ruleset),
      ...teamRange(team, { player: p }, ctx, season),
      rightsEnd,
      ...(line && { line }),
    }));
  }

  signingInterest(offer: Parameters<GmApi['league']['signingInterest']>[0]) {
    const { teamId } = offer;
    const { state } = this.open();
    const player = state.players[offer.playerId];
    if (!player || player.teamId !== (offer.resign ? teamId : null) || !state.teams[teamId]) {
      return null;
    }
    return signingInterest(state, defaultContext(state.rulesetId), player, teamId, offer);
  }

  feed(limit: number, minImportance?: Importance) {
    const { save, state } = this.open();
    const events = save.listEvents(limit, minImportance);
    const ids = new Set<string>();
    for (const e of events) {
      if ('playerId' in e && e.playerId) ids.add(e.playerId);
      if (e.kind === 'player.drafted') ids.add(e.player.id);
      if (e.kind === 'freeAgency.offered') ids.add(e.offer.playerId);
    }
    const names: Record<string, string> = {};
    const ages: Record<string, number> = {};
    const missing: string[] = [];
    const note = (p: Player) => {
      names[p.id] = `${p.firstName} ${p.lastName}`;
      ages[p.id] = state.date.season - p.birthYear;
    };
    for (const id of ids) {
      const p = state.players[id] ?? state.prospects[id as PlayerId]?.player;
      if (p) note(p);
      else missing.push(id);
    }
    // Retired since: look them up in the save (rare, so only when needed).
    if (missing.length) {
      for (const p of save.listPlayers(true)) if (missing.includes(p.id)) note(p);
    }
    return { events, names, ages, stories: storyOf(events) };
  }

  /**
   * `input` is untrusted (the renderer's, or a guest's): nothing runs before it parses. `actor` is
   * who sent it, never taken from the input: the host builds a guest's from its own seat table,
   * as a function, so it is worked out when the command's turn comes and not when it arrived.
   */
  dispatch(input: unknown, actor: Actor | (() => Actor) = LOCAL): Promise<CommandResult> {
    const parsed = parseCommand(input);
    if (!parsed.ok) return Promise.resolve(parsed);
    // A mirror never runs the sim: the command goes to the host and comes back as events.
    if (this.path === ':memory:')
      return (
        this.forward?.(parsed.command) ?? Promise.reject(new Error('A mirror runs no command.'))
      );
    return this.enqueue(() =>
      this.runCommand(parsed.command, typeof actor === 'function' ? actor() : actor),
    );
  }

  /**
   * A mirror's entry: one command's events from the host, applied and saved as the host did.
   * `seq` is the host's event count before them: a lost or repeated batch throws and changes nothing.
   */
  applyRemote(events: LeagueEvent[], seq: number): Promise<void> {
    return this.enqueue(() => {
      if (this.path !== ':memory:') throw new Error('Only a mirror takes events from a host.');
      const open = this.open();
      if (seq !== open.state.eventSeq)
        throw new Error(`events from ${seq}, the mirror is at ${open.state.eventSeq}`);
      this.apply(open, events);
    });
  }

  private enqueue<T>(job: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runCommand(command: Command, actor: Actor): Promise<CommandResult> {
    const open = this.open();
    const legends = command.kind === 'staff.hire' ? this.hallOfFame() : [];
    const req = { state: open.state, command, actor, xg: this.xg, legends };
    const result = await this.runInWorker(req);
    if (result.ok) this.apply(open, result.events, actor);
    return result;
  }

  private apply(
    { save, state }: { save: SaveFile; state: LeagueState },
    events: LeagueEvent[],
    actor?: Actor,
  ) {
    const seq = state.eventSeq;
    const report = this.onPersisted;
    // The state keeps parts of an event and changes them later: copy first, only when hosting.
    const untouched = report ? structuredClone(events) : events;
    try {
      for (const e of events) applyEvent(state, e);
      save.persist(events, state);
    } catch (err) {
      // Memory is ahead of the disk (the write rolled back) or half applied: go back to what the
      // disk has.
      this.state = save.loadState();
      throw err;
    }
    report?.(untouched, seq, actor);
  }

  private runInWorker(req: WorkerRequest): Promise<CommandResult> {
    const worker = (this.worker ??= createSimWorker({}));
    return new Promise((resolve, reject) => {
      const onMessage = (res: CommandResult) => {
        worker.off('error', onError);
        resolve(res);
      };
      const onError = (err: Error) => {
        worker.off('message', onMessage);
        this.worker = null; // the thread is dead: the next command starts a new one
        reject(err);
      };
      worker.once('message', onMessage);
      worker.once('error', onError);
      worker.postMessage(req);
    });
  }

  dispose() {
    void this.worker?.terminate();
    this.save?.close();
  }
}
