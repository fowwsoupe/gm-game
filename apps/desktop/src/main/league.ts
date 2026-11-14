import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';
import { app } from 'electron';
import { openSave, type SaveFile } from '@gm/data';
import {
  computeStandings,
  generateFictionalLeague,
  roundRobinSchedule,
  Rng,
  teamStrength,
  type TeamStrength,
} from '@gm/sim';
import type { GameId, GameResult, TeamId } from '@gm/shared';
import createSimWorker from './sim.worker?nodeWorker';
import type { SimRequest, SimResponse } from './sim.worker';

const SEASON = 2027;

/**
 * Owns the open save file and orchestrates sim + storage.
 * This is the only place that combines @gm/sim and @gm/data.
 */
export class LeagueService {
  private save: SaveFile | null = null;
  private worker: Worker = createSimWorker({});

  private savePath() {
    return join(app.getPath('userData'), 'saves', 'league-1.sqlite');
  }

  private requireSave(): SaveFile {
    if (!this.save) {
      this.save = openSave(this.savePath());
    }
    return this.save;
  }

  newLeague(seed: number) {
    this.save?.close();
    mkdirSync(join(app.getPath('userData'), 'saves'), { recursive: true });
    rmSync(this.savePath(), { force: true });
    this.save = openSave(this.savePath());

    const rng = new Rng(seed);
    const { teams, players } = generateFictionalLeague(rng.fork('league'));
    const schedule = roundRobinSchedule(
      teams.map((t) => t.id),
      82,
      rng.fork('schedule'),
    );
    this.save.insertLeague(teams, players);
    this.save.insertSchedule(SEASON, schedule);
    this.save.setMeta('rngState', String(rng.fork('games').state));
    return { teams };
  }

  listTeams() {
    return this.requireSave().listTeams();
  }

  standings() {
    const save = this.requireSave();
    return computeStandings(
      save.listTeams().map((t) => t.id),
      save.playedResults(SEASON),
    );
  }

  async simDays(days: number): Promise<{ results: GameResult[] }> {
    const save = this.requireSave();
    const games = save.nextUnplayed(SEASON, days);
    if (games.length === 0) return { results: [] };

    const players = save.listPlayers();
    const strength = new Map<TeamId, TeamStrength>();
    for (const t of save.listTeams())
      strength.set(t.id, teamStrength(players.filter((p) => p.teamId === t.id)));

    const req: SimRequest = {
      seed: Number(save.getMeta('rngState') ?? 1),
      matchups: games.map((g) => ({
        id: g.id as GameId,
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        home: strength.get(g.homeTeamId)!,
        away: strength.get(g.awayTeamId)!,
      })),
    };
    const res = await this.runWorker(req);
    save.recordResults(res.results);
    save.setMeta('rngState', String(res.nextSeed));
    return { results: res.results };
  }

  private runWorker(req: SimRequest): Promise<SimResponse> {
    return new Promise((resolve, reject) => {
      const onMessage = (res: SimResponse) => {
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
