import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';
import { app } from 'electron';
import { openSave, type SaveFile } from '@gm/data';
import {
  applyEvent,
  computeStandings,
  createLeague,
  defaultContext,
  teamRecords,
  type LeagueState,
} from '@gm/sim';
import type { Actor, Command, CommandResult, Importance, LeagueEvent, TeamId } from '@gm/shared';
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
    const roster = ctx.sport.importRoster(json);
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
    return teamRecords(seasons, champions);
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
    const result = await this.runInWorker({ state, command, actor: LOCAL });
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
