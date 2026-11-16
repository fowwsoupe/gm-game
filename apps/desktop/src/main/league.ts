import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';
import { app } from 'electron';
import { openSave, type SaveFile } from '@gm/data';
import {
  applyEvent,
  capSheet,
  computeStandings,
  createLeague,
  defaultContext,
  phaseOf,
  parseXgTable,
  playerProfiles,
  playerRecords,
  resignOffers,
  Rng,
  teamRecords,
  type LeagueState,
} from '@gm/sim';
import type {
  Actor,
  Command,
  CommandResult,
  GameDetail,
  GameId,
  GameResult,
  GameSummary,
  Importance,
  LeagueEvent,
  RosterPlayer,
  TeamId,
} from '@gm/shared';
import createSimWorker from './sim.worker?nodeWorker';
import type { WorkerRequest } from './sim.worker';

/** Single-player: the local human. Multiplayer will pass real actors from the network. */
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
  private worker: Worker = createSimWorker({});
  /** Commands run one at a time, in order. */
  private queue: Promise<unknown> = Promise.resolve();

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

  private context(rulesetId: string) {
    const xg = this.xg === undefined ? undefined : parseXgTable(this.xg);
    return defaultContext(rulesetId, xg?.ok ? { goalModel: xg.model } : {});
  }

  private savePath() {
    return join(app.getPath('userData'), 'saves', 'league-1.sqlite');
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
    this.save?.close();
    mkdirSync(join(app.getPath('userData'), 'saves'), { recursive: true });
    rmSync(this.savePath(), { force: true });
    this.save = openSave(this.savePath());
    this.state = state;
    this.save.saveNewLeague(this.state);
    return { teams: this.save.listTeams() };
  }

  listTeams() {
    return this.open().save.listTeams();
  }

  standings() {
    const { state } = this.open();
    return computeStandings(
      Object.keys(state.teams) as TeamId[],
      Object.values(state.results),
      defaultContext(state.rulesetId).ruleset.season.points,
    );
  }

  playoffs() {
    const { state } = this.open();
    return { series: Object.values(state.playoffSeries), championTeamId: state.championTeamId };
  }

  awards() {
    return this.open().save.listAwards();
  }

  leaders() {
    const { state } = this.open();
    const results = Object.values(state.results).filter((g) => !g.playoffSeriesId);
    return defaultContext(state.rulesetId).sport.leaders(results, Object.values(state.players), 10);
  }

  records() {
    const { save, state } = this.open();
    const points = defaultContext(state.rulesetId).ruleset.season.points;
    const teamIds = Object.keys(state.teams) as TeamId[];
    const seasons = save.finishedSeasons().map((season) => ({
      season,
      rows: computeStandings(
        teamIds,
        save.playedResults(season).filter((g) => !g.playoffSeriesId),
        points,
      ),
    }));
    const champions = save
      .listAwards()
      .filter((a) => a.award === 'champion')
      .map((a) => a.teamId);
    const everyone = save.listPlayers(true);
    const sport = defaultContext(state.rulesetId).sport;
    const boards = seasons.map(({ season }) => ({
      season,
      boards: sport.leaders(
        save.playedResults(season).filter((g) => !g.playoffSeriesId),
        everyone,
        1,
      ),
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
        playoff: !!g.playoffSeriesId,
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
    const ctx = this.context(state.rulesetId);
    const strength = (id: TeamId) =>
      ctx.sport.teamStrength(
        Object.values(state.players).filter(
          (p) => p.teamId === id && (p.injuredUntil ?? 0) <= state.date.day,
        ),
      );
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
    return { result, names };
  }

  /** Players on the team now, including ones whose contract ends this season. */
  roster(teamId: TeamId): RosterPlayer[] {
    return Object.values(this.open().state.players)
      .filter((p) => p.teamId === teamId)
      .map(({ id, firstName, lastName, birthYear, position, contract }) => ({
        id,
        firstName,
        lastName,
        birthYear,
        position,
        ...(contract && { contract }),
      }));
  }

  resignOffers(teamId: TeamId) {
    const { state } = this.open();
    return resignOffers(state, defaultContext(state.rulesetId), teamId);
  }

  players(teamId: TeamId | null) {
    const { state } = this.open();
    return playerProfiles(state, defaultContext(state.rulesetId), teamId);
  }

  feed(limit: number, minImportance?: Importance): LeagueEvent[] {
    return this.open().save.listEvents(limit, minImportance);
  }

  dispatch(command: Command): Promise<CommandResult> {
    const run = this.queue.then(() => this.runCommand(command));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runCommand(command: Command): Promise<CommandResult> {
    const { save, state } = this.open();
    const result = await this.runInWorker({ state, command, actor: LOCAL, xg: this.xg });
    if (result.ok) {
      for (const e of result.events) applyEvent(state, e);
      save.persist(result.events, state);
    }
    return result;
  }

  private runInWorker(req: WorkerRequest): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const onMessage = (res: CommandResult) => {
        this.worker.off('error', onError);
        resolve(res);
      };
      const onError = (err: Error) => {
        this.worker.off('message', onMessage);
        reject(err);
      };
      this.worker.once('message', onMessage);
      this.worker.once('error', onError);
      this.worker.postMessage(req);
    });
  }

  dispose() {
    void this.worker.terminate();
    this.save?.close();
  }
}
