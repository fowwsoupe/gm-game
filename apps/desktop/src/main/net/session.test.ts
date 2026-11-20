import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, expect, it, vi } from 'vitest';
import { SAVE_SCHEMA, type SaveFile } from '@gm/data';
import { WIRE, type Command, type GuestMessage, type HostMessage, type TeamId } from '@gm/shared';
import { handleCommand, type LeagueState } from '@gm/sim';
import type { WorkerRequest } from '../sim.worker';
import { contextWithXg } from '../simContext';
import { decode, encode } from './codec';
import { GuestSession } from './guest';
import { HostSession } from './host';
import { loopback } from './transport';

const dir = mkdtempSync(join(tmpdir(), 'gm-session-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
vi.mock('electron', () => ({ app: { getPath: () => dir } }));

/** The sim worker without its thread, as in `mirror.test.ts`: the real handler on a copy of the state. */
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
vi.mock('../sim.worker?nodeWorker', () => ({ default: () => new SimWorker() }));

const { LeagueService } = await import('../league');
type Service = InstanceType<typeof LeagueService>;
const inside = (svc: Service) => svc as unknown as { state: LeagueState; save: SaveFile };

const APP = '1.2.3';
const days = (n: number): Command => ({ kind: 'sim.advance', days: n, stopOn: 'never' });

it('a host and its guests over the loopback: one league, one authority', async () => {
  const host = new LeagueService();
  host.newLeague(42);
  const mirror = new LeagueService(':memory:');
  const teams = host.listTeams();
  const hostTeam = teams.find((t) => t.userControlled)!.id;
  const guestTeam = teams.find((t) => !t.userControlled)!.id;
  const net = loopback();

  /** State, the save's own reading of itself and every row: the mirror's against the host's. */
  const same = (m = mirror) => {
    const h = inside(host);
    expect(inside(m).state).toEqual(h.state);
    expect(inside(m).save.loadState()).toEqual(h.state);
    const rows = host.snapshot();
    const mirrored = m.snapshot();
    expect(mirrored.seq).toBe(rows.seq);
    for (const [i, t] of rows.tables.entries())
      expect(JSON.stringify(mirrored.tables[i]) === JSON.stringify(t), t.table).toBe(true);
  };

  // The host's start checks: nobody out of work, no string the wire refuses, "can be fired" off.
  const { state, save } = inside(host);
  state.career = { firedFrom: hostTeam, season: state.date.season, offers: [] };
  await expect(HostSession.start(host, net.host, { appVersion: APP })).rejects.toThrow(
    'out of work',
  );
  state.career = null;
  save.setMeta('motto', '__proto__');
  await expect(HostSession.start(host, net.host, { appVersion: APP })).rejects.toThrow(
    'table meta holds a name',
  );
  save.setMeta('motto', 'none');
  expect(host.status().canBeFired).toBe(true);
  await expect(net.guest.connect()).rejects.toThrow('Nobody is hosting');
  const session = await HostSession.start(host, net.host, { appVersion: APP, joinCode: true });
  expect(host.status().canBeFired).toBe(false);
  const joinCode = session.joinCode!;
  expect(joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

  /** A guest written by hand: his `hello`, all the host sends him, and the end of his connection. */
  const byHand = async (hello: Partial<Extract<GuestMessage, { kind: 'hello' }>> = {}) => {
    const connection = await net.guest.connect();
    const got: HostMessage[] = [];
    connection.onPacket = (packet) => got.push(decode('host', packet));
    const closed = new Promise<void>((resolve) => (connection.onClose = resolve));
    const mine = { protocol: WIRE.protocol, appVersion: APP, saveSchema: SAVE_SCHEMA, joinCode };
    connection.send(encode({ kind: 'hello', name: 'Hand', ...mine, ...hello }));
    return { connection, got, closed };
  };

  // The handshake: another protocol, build or save schema, or no code, is told why and let go.
  const wrong = {
    protocol: { protocol: WIRE.protocol + 1 },
    appVersion: { appVersion: '1.2.4' },
    saveSchema: { saveSchema: SAVE_SCHEMA + 1 },
    joinCode: { joinCode: '000000' },
  };
  for (const [reason, hello] of Object.entries(wrong)) {
    const refused = await byHand(hello);
    await refused.closed;
    expect(refused.got).toEqual([{ kind: 'refused', reason }]);
  }
  const old = { appVersion: '1.2.4', name: 'Guy', joinCode };
  await expect(GuestSession.join(mirror, net.guest, old)).rejects.toThrow('refused: appVersion');
  expect(session.list()).toEqual([]);
  expect(() => mirror.listTeams()).toThrow('No league yet');

  // A guest joins: his mirror is the host's league, and he holds no team.
  const guest = await GuestSession.join(mirror, net.guest, {
    appVersion: APP,
    name: 'Guy',
    joinCode,
  });
  same();
  const { key } = session.list()[0]!;
  expect(session.list()).toEqual([{ key, name: 'Guy', teamId: null }]);

  /** A command of the guest's that the host refuses: the league does not move. */
  const refused = async (command: Command) => {
    const { seq } = host.head();
    expect(await mirror.dispatch(command), command.kind).toMatchObject({
      ok: false,
      error: { code: 'not_allowed' },
    });
    expect(host.head().seq).toBe(seq);
  };
  const price = (teamId: TeamId): Command => ({ kind: 'finance.setTicketPrice', teamId, pct: 20 });

  // A peer with no team can do nothing.
  await refused(price(guestTeam));
  await refused(price(hostTeam));
  await refused(days(1));

  // The host seats him: the AI team becomes his, and the mirror hears of it like any other event.
  const settled = () =>
    vi.waitFor(() => expect(mirror.head().seq).toBe(host.head().seq), { timeout: 20_000 });
  await session.seat(key, guestTeam);
  await settled();
  expect(session.list()).toEqual([{ key, name: 'Guy', teamId: guestTeam }]);
  expect(mirror.listTeams().find((t) => t.id === guestTeam)!.userControlled).toBe(true);
  await expect(session.seat('nobody', hostTeam)).rejects.toThrow('No such guest');

  // A second guest, by hand, listens to all that follows. The seat is taken.
  const hand = await byHand();
  await vi.waitFor(() => expect(hand.got.at(-1)?.kind).toBe('snapshot.end'));
  const handKey = session.list().find((g) => g.name === 'Hand')!.key;
  await expect(session.seat(handKey, guestTeam)).rejects.toThrow('That team has a GM');

  /** A command on the host's own machine, then the mirror once it has caught up. */
  const hosts = async (command: Command) => {
    const result = await host.dispatch(command);
    if (!result.ok) throw new Error(`${command.kind}: ${result.error.message}`);
    await settled();
    same();
  };
  /** A command on the guest's machine: answered once his mirror holds what it did. */
  const guests = async (command: Command) => {
    const result = await mirror.dispatch(command);
    if (!result.ok) throw new Error(`${command.kind}: ${result.error.message}`);
    expect(result.events.length).toBeGreaterThan(0);
    same();
  };

  // A stretch of days with commands from both sides.
  await hosts(days(5));
  await guests(price(guestTeam));
  // The other GM's team, the clock without the grant, a host's tool: refused, nothing changes.
  await refused(price(hostTeam));
  await refused(days(1));
  await refused({ kind: 'league.setCanBeFired', on: true });
  same();

  // A trade between the two GMs: the host offers, the guest reads it on his mirror and says yes.
  const cheapest = (teamId: TeamId) =>
    host
      .roster(teamId)
      .filter((p) => p.position === 'C' && p.contract)
      .sort((a, b) => a.contract!.capHit - b.contract!.capHit)[0]!.id;
  const proposal = {
    fromTeamId: hostTeam,
    toTeamId: guestTeam,
    give: [cheapest(hostTeam)],
    get: [cheapest(guestTeam)],
  };
  await refused({ kind: 'trade.propose', proposal }); // the host's offer is not the guest's to send
  await hosts({ kind: 'trade.propose', proposal });
  const [offer] = mirror.tradeOffers(guestTeam);
  expect(offer?.proposal).toEqual(proposal);
  await guests({ kind: 'trade.respond', offerId: offer!.id, accept: true });
  expect(host.roster(guestTeam).map((p) => p.id)).toContain(proposal.give[0]);
  expect(mirror.roster(hostTeam).map((p) => p.id)).toContain(proposal.get[0]);
  await guests({
    kind: 'trade.block',
    teamId: guestTeam,
    playerId: proposal.give[0]!,
    onBlock: true,
  });
  await hosts(days(60)); // long enough that its events go out in several pieces

  // The guest by hand was sent every batch, the long one in pieces, and nobody else's request id.
  const batches = hand.got.flatMap((m) => (m.kind === 'events' ? [m] : []));
  expect(batches.at(-1)!.seq + batches.at(-1)!.events.length).toBe(host.head().seq);
  expect(batches.some((m) => !m.last)).toBe(true);
  expect(batches.some((m) => 'requestId' in m)).toBe(false);
  // A message that carries an actor is refused whole: his connection ends and nothing runs.
  const { seq } = host.head();
  const forged = {
    kind: 'command',
    requestId: 1,
    command: days(1),
    actor: { id: 'local', controls: [hostTeam] },
  };
  hand.connection.send(deflateSync(JSON.stringify(forged)));
  await hand.closed;
  expect(session.list().map((g) => g.name)).toEqual(['Guy']);
  expect(host.head().seq).toBe(seq);

  // Someone who joins now gets the league as it stands; when he leaves, the host's list forgets him.
  const late = new LeagueService(':memory:');
  const second = await GuestSession.join(late, net.guest, {
    appVersion: APP,
    name: 'Late',
    joinCode,
  });
  same(late);
  second.leave();
  expect(await second.ended).toBe('left');
  await vi.waitFor(() => expect(session.list().map((g) => g.name)).toEqual(['Guy']));
  await expect(late.dispatch(days(1))).rejects.toThrow('disconnected');

  // By now a table's rows take several messages.
  const last = await byHand();
  await vi.waitFor(() => expect(last.got.at(-1)?.kind).toBe('snapshot.end'));
  const tables = last.got.flatMap((m) => (m.kind === 'snapshot.rows' ? [m.table] : []));
  expect(tables.length).toBeGreaterThan(new Set(tables).size);

  // The host closes: the guests are told, their commands fail, and the mirror stays what it was.
  session.close();
  await last.closed;
  expect(last.got.at(-1)).toEqual({ kind: 'bye', reason: 'closed' });
  expect(await guest.ended).toBe('closed');
  await expect(mirror.dispatch(price(guestTeam))).rejects.toThrow('disconnected');
  await expect(net.guest.connect()).rejects.toThrow('Nobody is hosting');
  same();

  // Only the host ever ran the sim.
  expect(SimWorker.started).toBe(1);
  host.dispose();
  mirror.dispose();
  late.dispose();
}, 300_000);
