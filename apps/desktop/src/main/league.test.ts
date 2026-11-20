import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HockeyBoxScore } from '@gm/shared';

const dir = mkdtempSync(join(tmpdir(), 'gm-svc-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
vi.mock('electron', () => ({ app: { getPath: () => dir } }));

/** A stand-in for the sim worker: tests decide what each command gets back. */
class FakeWorker extends EventEmitter {
  static all: FakeWorker[] = [];
  reply: 'ok' | 'die' | 'bad-event' = 'ok';
  constructor() {
    super();
    FakeWorker.all.push(this);
  }
  postMessage() {
    if (this.reply === 'die') queueMicrotask(() => this.emit('error', new Error('boom')));
    else if (this.reply === 'bad-event')
      // The sim state accepts this event, but the save refuses it (unknown teams break a foreign
      // key), so the write fails and rolls back.
      queueMicrotask(() =>
        this.emit('message', {
          ok: true,
          events: [
            {
              id: 'e1',
              kind: 'series.started',
              importance: 'minor',
              teamIds: [],
              date: { season: 2027, day: 0 },
              series: {
                id: 's2027_x',
                round: 1,
                higherSeed: 1,
                lowerSeed: 2,
                higherTeamId: 'ghost1',
                lowerTeamId: 'ghost2',
                higherWins: 0,
                lowerWins: 0,
              },
            },
          ],
        }),
      );
    else queueMicrotask(() => this.emit('message', { ok: true, events: [] }));
  }
  terminate() {
    return Promise.resolve(0);
  }
}
vi.mock('./sim.worker?nodeWorker', () => ({ default: () => new FakeWorker() }));

const { LeagueService } = await import('./league');
const cmd = { kind: 'sim.advance', days: 1 } as const;

describe('LeagueService', () => {
  beforeEach(() => {
    FakeWorker.all = [];
  });

  it('says there is no league on a first run, instead of failing on a missing folder', () => {
    rmSync(join(dir, 'saves'), { recursive: true, force: true });
    const svc = new LeagueService();
    expect(() => svc.listTeams()).toThrow('No league yet');
    svc.dispose();
  });

  it('replaces the save with a new league and leaves no temp file', () => {
    const svc = new LeagueService();
    const a = svc.newLeague(1);
    const b = svc.newLeague(2);
    expect(a.teams.length).toBeGreaterThan(0);
    expect(b.teams.length).toBe(a.teams.length);
    expect(existsSync(join(dir, 'saves', 'league-1.sqlite.new'))).toBe(false);
    svc.dispose();
  });

  it('plays an exhibition with its timeline, the same game for the same seed', () => {
    const svc = new LeagueService();
    const [home, away] = svc.newLeague(1).teams;
    const game = svc.exhibition(home!.id, away!.id, 7);
    const box = game.result.box as HockeyBoxScore;
    expect(box.timeline!.shifts.length).toBeGreaterThan(50);
    expect(svc.exhibition(home!.id, away!.id, 7)).toEqual(game);
    svc.dispose();
  });

  it('keeps working after the worker dies', async () => {
    const svc = new LeagueService();
    svc.newLeague(1);
    FakeWorker.all[0]!.reply = 'die';
    await expect(svc.dispatch(cmd)).rejects.toThrow('boom');
    const res = await svc.dispatch(cmd); // goes to the replacement worker
    expect(res.ok).toBe(true);
    svc.dispose();
  });

  it('goes back to what the disk has when saving fails', async () => {
    const svc = new LeagueService();
    svc.newLeague(1);
    FakeWorker.all[0]!.reply = 'bad-event';
    await expect(svc.dispatch(cmd)).rejects.toThrow(/FOREIGN KEY/);
    expect(svc.playoffs().series).toHaveLength(0); // the phantom series is gone
    FakeWorker.all[0]!.reply = 'ok';
    expect((await svc.dispatch(cmd)).ok).toBe(true); // state was reloaded, not left broken
    svc.dispose();
  });
});
