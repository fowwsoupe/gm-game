import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SAVE_SCHEMA, type SaveFile } from '@gm/data';
import {
  WIRE,
  type Command,
  type GuestMessage,
  type HostMessage,
  type LeagueEvent,
  type TeamId,
} from '@gm/shared';
import { handleCommand, type LeagueState } from '@gm/sim';
import type { WorkerRequest } from '../sim.worker';
import { contextWithXg } from '../simContext';
import { decode, encode } from './codec';
import { GuestSession } from './guest';
import { HostSession } from './host';
import { loopback, type Loopback } from './transport';

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

// The sessions' clock (heartbeat, timeouts, rates) is the test's: it moves when a test says so,
// and 50 ms at each look of a `vi.waitFor`.
const undo: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const restore of undo.splice(0)) restore();
});

type Limit = 'replayBytes' | 'backlogBytes' | 'batchBytes' | 'snapshotBytes';
/** One of the wire's limits brought within a test's reach, until the test ends or `restore`. */
function limit(key: Limit, value: number) {
  const wire = WIRE as Record<Limit, number>;
  const was = wire[key];
  wire[key] = value;
  const restore = () => {
    wire[key] = was;
  };
  undo.push(restore);
  return restore;
}

/** Lets the sessions' clock run, a second at a time, until `done`: two minutes of it at most. */
async function until(done: () => boolean) {
  for (let s = 0; s < 120 && !done(); s++) await vi.advanceTimersByTimeAsync(1000);
  expect(done()).toBe(true);
}

const APP = '1.2.3';
const days = (n: number): Command => ({ kind: 'sim.advance', days: n, stopOn: 'never' });
const price = (teamId: TeamId): Command => ({ kind: 'finance.setTicketPrice', teamId, pct: 20 });

/** A command that must pass, on the host's machine or through a guest's mirror. */
async function run(svc: Service, command: Command) {
  const result = await svc.dispatch(command);
  if (!result.ok) throw new Error(`${command.kind}: ${result.error.message}`);
  return result;
}

/** State, the save's own reading of itself and every row: the mirror's against the host's. */
function identical(host: Service, mirror: Service) {
  const h = inside(host);
  expect(inside(mirror).state).toEqual(h.state);
  expect(inside(mirror).save.loadState()).toEqual(h.state);
  const rows = host.snapshot();
  const mirrored = mirror.snapshot();
  expect(mirrored.seq).toBe(rows.seq);
  for (const [i, t] of rows.tables.entries())
    expect(JSON.stringify(mirrored.tables[i]) === JSON.stringify(t), t.table).toBe(true);
}
const caughtUp = (host: Service, mirror: Service) =>
  vi.waitFor(() => expect(mirror.head().seq).toBe(host.head().seq), { timeout: 20_000 });

/**
 * A connection held by hand: all the host sends on it and its end. The host's pings are answered
 * and left out, unless `silent`.
 */
async function byHand(net: Loopback, silent = false) {
  const connection = await net.guest.connect();
  const got: HostMessage[] = [];
  const send = (message: GuestMessage) => connection.send(encode(message));
  connection.onPacket = (packet) => {
    const message = decode('host', packet);
    if (message.kind === 'ping' && !silent) send({ kind: 'pong' });
    else got.push(message);
  };
  let open = true;
  const closed = new Promise<void>((resolve) => {
    connection.onClose = () => {
      open = false;
      resolve();
    };
  });
  return { connection, got, send, closed, isOpen: () => open };
}
type Hand = Awaited<ReturnType<typeof byHand>>;
type Hello = Extract<GuestMessage, { kind: 'hello' }>;
const HELLO: Hello = {
  kind: 'hello',
  protocol: WIRE.protocol,
  appVersion: APP,
  saveSchema: SAVE_SCHEMA,
  name: 'Hand',
};

/** A guest by hand: his `hello`, then the league asked for whole. */
async function handGuest(net: Loopback, hello: Partial<Hello> = {}, silent = false) {
  const hand = await byHand(net, silent);
  hand.send({ ...HELLO, ...hello });
  hand.send({ kind: 'resync' });
  return hand;
}
const ends = (hand: Hand) => hand.got.filter((m) => m.kind === 'snapshot.end').length;
/** The snapshot he asked for is in. */
const whole = (hand: Hand) => vi.waitFor(() => expect(hand.got.at(-1)?.kind).toBe('snapshot.end'));
/** The host closed his connection. */
const gone = (hand: Hand) => vi.waitFor(() => expect(hand.isOpen()).toBe(false));

/** A hosted league with one guest in, seated on a team: where each test of drops and limits starts. */
async function hosted(file: string) {
  const host = new LeagueService(join(dir, `${file}.sqlite`));
  host.newLeague(42);
  const net = loopback();
  const session = await HostSession.start(host, net.host, { appVersion: APP, joinCode: true });
  const joinCode = session.joinCode!;
  const mirror = new LeagueService(':memory:');
  const guest = await GuestSession.join(mirror, net.guest, {
    appVersion: APP,
    name: 'Guy',
    joinCode,
  });
  const team = host.listTeams().find((t) => !t.userControlled)!.id;
  await session.seat('1', team);
  await caughtUp(host, mirror);
  /** Why the guest's session ended, once it has. */
  const over: { reason?: string } = {};
  void guest.ended.then((reason) => (over.reason = reason));
  const seated = { key: '1', name: 'Guy', teamId: team };
  return { host, net, session, joinCode, mirror, guest, over, team, seated };
}

it('a host and its guests over the loopback: one league, one authority', async () => {
  const host = new LeagueService();
  host.newLeague(42);
  const mirror = new LeagueService(':memory:');
  const teams = host.listTeams();
  const hostTeam = teams.find((t) => t.userControlled)!.id;
  const guestTeam = teams.find((t) => !t.userControlled)!.id;
  const net = loopback();
  const same = (m = mirror) => identical(host, m);

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

  // The handshake: another protocol, build or save schema, or no code (a resume key that is
  // nobody's does not stand in for it), is told why and let go.
  const wrong = {
    protocol: { protocol: WIRE.protocol + 1 },
    appVersion: { appVersion: '1.2.4' },
    saveSchema: { saveSchema: SAVE_SCHEMA + 1 },
    joinCode: { joinCode: '000000', resumeKey: 'f'.repeat(32) },
  };
  for (const [reason, hello] of Object.entries(wrong)) {
    const refused = await handGuest(net, { joinCode, ...hello });
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
  expect(session.list()).toEqual([{ key, name: 'Guy', teamId: null, connected: true }]);

  /** A command of the guest's that the host refuses: the league does not move. */
  const refused = async (command: Command) => {
    const { seq } = host.head();
    expect(await mirror.dispatch(command), command.kind).toMatchObject({
      ok: false,
      error: { code: 'not_allowed' },
    });
    expect(host.head().seq).toBe(seq);
  };

  // A peer with no team can do nothing.
  await refused(price(guestTeam));
  await refused(price(hostTeam));
  await refused(days(1));

  // The host seats him: the AI team becomes his, and the mirror hears of it like any other event.
  const settled = () => caughtUp(host, mirror);
  await session.seat(key, guestTeam);
  await settled();
  expect(session.list()).toEqual([{ key, name: 'Guy', teamId: guestTeam, connected: true }]);
  expect(mirror.listTeams().find((t) => t.id === guestTeam)!.userControlled).toBe(true);
  await expect(session.seat('nobody', hostTeam)).rejects.toThrow('No such guest');

  // A second guest, by hand, listens to all that follows. The seat is taken.
  const hand = await handGuest(net, { joinCode });
  await whole(hand);
  const handKey = session.list().find((g) => g.name === 'Hand')!.key;
  await expect(session.seat(handKey, guestTeam)).rejects.toThrow('That team has a GM');

  /** A command on the host's own machine, then the mirror once it has caught up. */
  const hosts = async (command: Command) => {
    await run(host, command);
    await settled();
    same();
  };
  /** A command on the guest's machine: answered once his mirror holds what it did. */
  const guests = async (command: Command) => {
    const result = await run(mirror, command);
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
  const last = await handGuest(net, { joinCode });
  await whole(last);
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

it('a mirror that missed events catches up: from the buffer, or with the whole league again', async () => {
  const { host, net, session, mirror, seated } = await hosted('missed');
  const restores = vi.spyOn(mirror, 'restore');
  /** The loopback loses what the host sends the guest, where `lost` says so. */
  const lose = (lost: (message: HostMessage) => boolean) => {
    net.lose = (packet, to) => to === 'guest' && lost(decode('host', packet));
  };
  /**
   * The line is whole again, a `resync` may be answered again, and the next batch does not start
   * where the mirror stands: it asks, once, for all from its count on.
   */
  const noticed = async () => {
    delete net.lose;
    expect(mirror.head().seq).toBeLessThan(host.head().seq);
    await vi.advanceTimersByTimeAsync(WIRE.resyncEveryMs);
    await run(host, days(1));
    await caughtUp(host, mirror);
    identical(host, mirror);
  };

  // A whole batch lost on the way: the host sends it again from its buffer.
  lose(() => true);
  await run(host, days(1));
  await noticed();

  // The last piece of a long batch lost: the pieces held are let go, and the batch comes again.
  let pieces = 0;
  lose((m) => {
    if (m.kind !== 'events') return false;
    pieces++;
    return m.last;
  });
  await run(host, days(60));
  expect(pieces).toBeGreaterThan(1);
  await noticed();
  expect(restores).not.toHaveBeenCalled();

  // Too far behind for the buffer (it keeps nothing here): the whole league, as at the join.
  limit('replayBytes', 0);
  lose(() => true);
  await run(host, days(1));
  await noticed();
  expect(restores).toHaveBeenCalledTimes(1);

  // All of it on the connection he joined on.
  expect(session.list()).toEqual([{ ...seated, connected: true }]);
  session.close();
  host.dispose();
  mirror.dispose();
}, 300_000);

it('a guest who drops is back on his seat inside the session, and a stranger in a new one', async () => {
  const { host, net, session, joinCode, mirror, guest, over, team, seated } = await hosted('drops');
  const restores = vi.spyOn(mirror, 'restore');
  await run(mirror, price(team));

  // The line goes dead with no word: each side gives the other up, and the seat waits.
  net.lose = () => true;
  await until(() => !session.list()[0]!.connected);
  expect(session.list()).toEqual([{ ...seated, connected: false }]);
  await expect(mirror.dispatch(price(team))).rejects.toThrow('disconnected');
  await run(host, days(1)); // the league goes on without him
  // The line is back: his session gets in again by itself, to his place, and is sent what he missed.
  delete net.lose;
  await until(() => session.list()[0]!.connected);
  await caughtUp(host, mirror);
  expect(session.list()).toEqual([{ ...seated, connected: true }]);
  expect(restores).not.toHaveBeenCalled();
  identical(host, mirror);
  await run(mirror, price(team));
  identical(host, mirror);

  // A place opens to its resume key alone, with no code; a key that is nobody's opens nothing.
  const other = host.listTeams().find((t) => !t.userControlled)!.id;
  const hand = await handGuest(net, { joinCode });
  await whole(hand);
  const welcome = hand.got[0] as Extract<HostMessage, { kind: 'welcome' }>;
  await session.seat('2', other);
  hand.connection.close();
  const place = { key: '2', name: 'Hand', teamId: other };
  await vi.waitFor(() => expect(session.list()[1]).toEqual({ ...place, connected: false }));
  const stranger = await handGuest(net, { resumeKey: 'f'.repeat(32) });
  await gone(stranger);
  expect(stranger.got).toEqual([{ kind: 'refused', reason: 'joinCode' }]);
  const back = await handGuest(net, { resumeKey: welcome.resumeKey });
  await whole(back);
  expect(back.got[0]).toEqual(welcome);
  expect(session.list()[1]).toEqual({ ...place, connected: true });
  // He comes in again without having gone: the connection he held is closed, the place is his.
  const twice = await handGuest(net, { resumeKey: welcome.resumeKey });
  await gone(back);
  await whole(twice);
  expect(session.list()[1]).toEqual({ ...place, connected: true });
  // Unseated while away, he is forgotten: his team is free for someone else.
  twice.connection.close();
  await vi.waitFor(() => expect(session.list()[1]).toEqual({ ...place, connected: false }));
  await session.seat('2', null);
  expect(session.list()).toEqual([{ ...seated, connected: true }]);
  await caughtUp(host, mirror);

  // The host ends the session, the word of it lost, and hosts again. The guest's session finds a
  // league there and takes it whole, but his place was the old session's: he holds no team.
  net.lose = () => true;
  session.close();
  const next = await HostSession.start(host, net.host, { appVersion: APP });
  delete net.lose;
  await run(host, days(1));
  await until(() => next.list().length === 1);
  await caughtUp(host, mirror);
  expect(next.list()).toEqual([{ key: '1', name: 'Guy', teamId: null, connected: true }]);
  expect(restores).toHaveBeenCalledTimes(1);
  identical(host, mirror);
  expect(await mirror.dispatch(price(team))).toMatchObject({
    ok: false,
    error: { code: 'not_allowed' },
  });
  expect(over.reason).toBeUndefined();

  next.close();
  expect(await guest.ended).toBe('closed');
  host.dispose();
  mirror.dispose();
}, 300_000);

it('a flood, an oversized packet, a silent peer, a late hello: each ends that connection and nothing else', async () => {
  const { host, net, session, joinCode, mirror, team, seated } = await hosted('limits');
  const { seq } = host.head();

  // A packet over the limit, read no further than its length.
  const big = await byHand(net);
  big.connection.send(Buffer.alloc(WIRE.packetBytes + 1));
  await gone(big);

  // A `hello` that inflates past its 4 KB: a good one, padded.
  const padded = await byHand(net);
  const hello = JSON.stringify({ ...HELLO, joinCode });
  padded.connection.send(deflateSync(hello + ' '.repeat(WIRE.helloBytes)));
  await gone(padded);
  expect(padded.got).toEqual([]);

  // Once in, a message past a guest's 64 KB.
  const long = await handGuest(net, { joinCode });
  await whole(long);
  long.connection.send(deflateSync(`{"kind":"pong"${' '.repeat(WIRE.messageBytes.guest)}}`));
  await gone(long);

  // A flood. Up to the burst he is heard; one message more and he is gone.
  const flood = await handGuest(net, { joinCode }, true);
  await whole(flood);
  await vi.advanceTimersByTimeAsync((WIRE.rate.burst / WIRE.rate.perSecond) * 1000);
  for (let i = 0; i < WIRE.rate.burst; i++) flood.send({ kind: 'pong' });
  await vi.advanceTimersByTimeAsync(0);
  expect(flood.isOpen()).toBe(true);
  flood.send({ kind: 'pong' });
  await vi.advanceTimersByTimeAsync(0);
  expect(flood.isOpen()).toBe(false);

  // A second `resync` in a row on one connection, even the cheapest (he stands where the league
  // does); after the wait, he may have the whole save again.
  const greedy = await handGuest(net, { joinCode });
  await whole(greedy);
  greedy.send({ kind: 'resync', seq });
  await gone(greedy);
  expect(greedy.got.at(-1)?.kind).toBe('snapshot.end');
  const patient = await handGuest(net, { joinCode });
  await whole(patient);
  await vi.advanceTimersByTimeAsync(WIRE.resyncEveryMs);
  patient.send({ kind: 'resync' });
  await vi.waitFor(() => expect(ends(patient)).toBe(2));
  patient.connection.close();

  // A guest who takes the host's packets slower than they come: what waits for him has a limit.
  const backlog = limit('backlogBytes', 10_000);
  const slow = await handGuest(net, { joinCode });
  await gone(slow);
  expect(slow.got.map((m) => m.kind)).toContain('snapshot.begin');
  expect(ends(slow)).toBe(0);
  backlog();

  // No `hello` in time, and a guest who answers no ping.
  const mute = await byHand(net);
  const silent = await handGuest(net, { joinCode }, true);
  await vi.advanceTimersByTimeAsync(WIRE.helloMs - 1);
  expect(mute.isOpen()).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(mute.isOpen()).toBe(false);
  expect(mute.got).toEqual([]);
  expect(silent.isOpen()).toBe(true);
  await vi.advanceTimersByTimeAsync(WIRE.pingMs * (WIRE.missedPings + 1) - WIRE.helloMs);
  expect(silent.isOpen()).toBe(false);
  expect(silent.got.filter((m) => m.kind === 'ping')).toHaveLength(WIRE.missedPings);

  // None of it moved the league, and the host's list holds the one guest who did nothing wrong.
  expect(host.head().seq).toBe(seq);
  await vi.waitFor(() => expect(session.list()).toEqual([{ ...seated, connected: true }]));

  // More of his commands at once than may wait: the ones over are refused, the others run.
  const asked = await Promise.all(
    Array.from({ length: WIRE.waitingCommands + 2 }, () => mirror.dispatch(price(team))),
  );
  expect(asked.filter((r) => r.ok)).toHaveLength(WIRE.waitingCommands);
  const over = { ok: false, error: { code: 'invalid', message: 'too many commands waiting' } };
  expect(asked.slice(WIRE.waitingCommands)).toEqual([over, over]);
  expect(host.head().seq).toBe(seq + WIRE.waitingCommands);

  // He is still a guest like any other.
  await run(host, days(1));
  await caughtUp(host, mirror);
  identical(host, mirror);
  expect(session.list()).toEqual([{ ...seated, connected: true }]);
  session.close();
  host.dispose();
  mirror.dispose();
}, 300_000);

it('a batch the mirror cannot apply: the whole league once more, then the end', async () => {
  const { host, net, session, joinCode, mirror, over, seated } = await hosted('unapplied');
  const restores = vi.spyOn(mirror, 'restore');
  // What the league saved, relabelled on its way out as an event the mirror's reducer chokes on.
  const send = host.onPersisted!;
  let spoiled = false;
  host.onPersisted = (events, seq, actor) => {
    const sent = events.map((e) => ({ ...e, kind: 'finance.settled' }) as unknown as LeagueEvent);
    send(spoiled ? sent : events, seq, actor);
  };
  const bad = async () => {
    spoiled = true;
    await run(host, days(1));
    spoiled = false;
  };

  // One: the mirror stands where its save does, asks for the league whole, and is the host's again.
  await vi.advanceTimersByTimeAsync(WIRE.resyncEveryMs);
  await bad();
  await caughtUp(host, mirror);
  identical(host, mirror);
  expect(restores).toHaveBeenCalledTimes(1);
  // A good batch, and the count starts again: the next bad one is one more gap.
  await run(host, days(1));
  await caughtUp(host, mirror);
  await vi.advanceTimersByTimeAsync(WIRE.resyncEveryMs);
  await bad();
  await caughtUp(host, mirror);
  identical(host, mirror);
  expect(restores).toHaveBeenCalledTimes(2);
  expect(over.reason).toBeUndefined();
  // Two in a row are not a gap: the session ends, saying why, and the seat waits on the host.
  await bad();
  await vi.waitFor(() => expect(over.reason).toMatch(/^the mirror cannot follow the host: /));
  expect(mirror.head().seq).toBeLessThan(host.head().seq);
  await vi.waitFor(() => expect(session.list()).toEqual([{ ...seated, connected: false }]));

  // What a guest takes in has totals of its own: one snapshot, and one command's events.
  const small = new LeagueService(':memory:');
  const joining = { appVersion: APP, name: 'Small', joinCode };
  const snapshots = limit('snapshotBytes', 1000);
  await expect(GuestSession.join(small, net.guest, joining)).rejects.toThrow('snapshot too big');
  snapshots();
  const second = await GuestSession.join(small, net.guest, joining);
  limit('batchBytes', 100); // less than one event: a quiet day's batch is a few hundred bytes
  await run(host, days(1));
  expect(await second.ended).toBe('batch too big');

  session.close();
  host.dispose();
  mirror.dispose();
  small.dispose();
}, 300_000);
