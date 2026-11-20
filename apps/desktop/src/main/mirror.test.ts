import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { SaveFile } from '@gm/data';
import type { Actor, Command, HostMessage } from '@gm/shared';
import { defaultContext, handleCommand, type LeagueState } from '@gm/sim';
import { decode, encode } from './net/codec';
import type { WorkerRequest } from './sim.worker';
import { contextWithXg } from './simContext';

const dir = mkdtempSync(join(tmpdir(), 'gm-mirror-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
vi.mock('electron', () => ({ app: { getPath: () => dir } }));

/** The sim worker without its thread: the real handler, on a copy of the state as a thread gets. */
class SimWorker extends EventEmitter {
  static started = 0;
  constructor() {
    super();
    SimWorker.started++;
  }
  postMessage(req: WorkerRequest) {
    const state = structuredClone(req.state);
    const ctx = contextWithXg(state.rulesetId, req.xg);
    const result = handleCommand(state, req.command, req.actor, ctx, req.legends);
    queueMicrotask(() => this.emit('message', result));
  }
  terminate() {
    return Promise.resolve(0);
  }
}
vi.mock('./sim.worker?nodeWorker', () => ({ default: () => new SimWorker() }));

const { LeagueService } = await import('./league');
type Service = InstanceType<typeof LeagueService>;
const inside = (svc: Service) => svc as unknown as { state: LeagueState; save: SaveFile };

/** Rows per `snapshot.rows` message: a season's box scores stay far under a packet. */
const ROWS = 200;

/** A snapshot as the host's messages, each one through the codec. */
function carried({ seq, tables }: ReturnType<Service['snapshot']>) {
  const sent: HostMessage[] = [{ kind: 'snapshot.begin' }];
  for (const { table, rows } of tables)
    for (let i = 0; i < rows.length; i += ROWS)
      sent.push({ kind: 'snapshot.rows', table, rows: rows.slice(i, i + ROWS) });
  const counts = Object.fromEntries(tables.map((t) => [t.table, t.rows.length]));
  sent.push({ kind: 'snapshot.end', seq, counts });
  const got = sent.map((m) => decode('host', encode(m)));
  const end = got.at(-1)!;
  if (end.kind !== 'snapshot.end') throw new Error(end.kind);
  return { pieces: got.flatMap((m) => (m.kind === 'snapshot.rows' ? [m] : [])), end };
}

it('a mirror built from rows and fed events through the codec stays equal to its host', async () => {
  const host = new LeagueService();
  host.newLeague(42);
  const mirror = new LeagueService(':memory:');
  const mine = host.listTeams().find((t) => t.userControlled)!.id;
  const cal = defaultContext().ruleset.season.calendar;
  const days = (n: number): Command => ({ kind: 'sim.advance', days: n, stopOn: 'never' });

  // A stretch on the host alone.
  expect((await host.dispatch(days(40))).ok).toBe(true);

  // A snapshot that is not whole leaves the mirror with no league, and its own save unopened.
  const { pieces, end } = carried(host.snapshot());
  expect(() => mirror.restore(pieces, { ...end.counts, teams: 1 })).toThrow('restore');
  expect(() => mirror.restore(pieces.slice(1), end.counts)).toThrow('restore');
  expect(() => mirror.listTeams()).toThrow('No league yet');
  // And the host's own save is never swapped for a snapshot.
  expect(() => host.restore(pieces, end.counts)).toThrow('Only a mirror');
  await expect(host.applyRemote([], 0)).rejects.toThrow('Only a mirror');
  mirror.restore(pieces, end.counts);
  expect(inside(mirror).state.eventSeq).toBe(end.seq);

  const same = () => {
    const h = inside(host);
    const m = inside(mirror);
    expect(m.state).toEqual(h.state);
    expect(m.save.loadState()).toEqual(h.state);
    const rows = host.snapshot();
    const mirrored = mirror.snapshot();
    expect(mirrored.seq).toBe(rows.seq);
    for (const [i, t] of rows.tables.entries())
      expect(JSON.stringify(mirrored.tables[i]) === JSON.stringify(t), t.table).toBe(true);
  };
  same();

  // From here every batch the host saves goes to the mirror, as a packet.
  const packets: Buffer[] = [];
  host.onPersisted = (events, seq) =>
    packets.push(encode({ kind: 'events', seq, events, last: true }));
  const step = async (command: Command, actor?: Actor) => {
    const result = await host.dispatch(command, actor);
    if (!result.ok) throw new Error(`${command.kind}: ${result.error.message}`);
    expect(packets).toHaveLength(1);
    const batch = decode('host', packets.pop()!);
    if (batch.kind !== 'events') throw new Error(batch.kind);
    expect(batch.seq).toBe(inside(mirror).state.eventSeq);
    expect(batch.events).toEqual(result.events);
    // A repeated or skipped batch is refused, and the mirror stays where it was.
    await expect(mirror.applyRemote(batch.events, batch.seq + 1)).rejects.toThrow('the mirror is at');
    await mirror.applyRemote(batch.events, batch.seq);
    same();
  };

  // The rest of the season and the playoffs.
  const season = cal.regularSeasonDays + cal.playoffDays;
  for (let day = 40; day < season; day += 30) await step(days(Math.min(30, season - day)));
  expect(host.status().championTeamId).not.toBeNull();

  // The summer: the draft up to the human's pick, his pick, the market, a rename, the new season.
  await step({ kind: 'offseason.startDraft' });
  const draft = host.draftClass(mine);
  expect(draft.order[0]?.teamId).toBe(mine);
  await step({ kind: 'draft.pick', teamId: mine, playerId: draft.prospects[0]!.id });
  await step({ kind: 'offseason.openFreeAgency' });
  await step({ kind: 'freeAgency.advanceDay' });
  await step({ kind: 'freeAgency.advanceDay' });
  await step({
    kind: 'team.rename',
    teamId: mine,
    city: 'Québec',
    name: 'Fleuves',
    abbreviation: 'QBF',
  });
  await step({ kind: 'season.rollover' });

  // Someone else's command: refused without the host's grant, and nothing goes out; run with it.
  const guest: Actor = { id: 'guest-1', controls: [] };
  expect(await host.dispatch(days(1), guest)).toMatchObject({
    ok: false,
    error: { code: 'not_allowed' },
  });
  expect(packets).toHaveLength(0);
  await step(days(10), { ...guest, can: ['advance'] });

  // A bad snapshot later leaves the mirror as it was.
  const later = carried(host.snapshot());
  expect(() => mirror.restore(later.pieces, { ...later.end.counts, teams: 1 })).toThrow('restore');
  same();

  // Only the host ever ran the sim.
  expect(SimWorker.started).toBe(1);
  host.dispose();
  mirror.dispose();
}, 300_000);
