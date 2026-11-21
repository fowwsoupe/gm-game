import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SAVE_SCHEMA } from '@gm/data';
import {
  CLOCK_COMMANDS,
  parseCommand,
  parseMessage,
  WIRE,
  type Actor,
  type Command,
  type CommandError,
  type CommandResult,
  type Grant,
  type GuestMessage,
  type HostMessage,
  type LeagueEvent,
  type Peer,
  type SessionPeer,
  type TeamId,
} from '@gm/shared';
import type { LeagueService } from '../league';
import { decode, encode } from './codec';
import type { Connection, HostTransport } from './transport';

/** About this much JSON in one message of a snapshot or of a long batch of events. */
const PIECE_CHARS = 512 * 1024;

/**
 * A list cut into pieces of about `PIECE_CHARS` of JSON each, so that every message fits a packet
 * (no single event or row comes near a piece). A list of none is one empty piece.
 */
function pieces<T>(items: readonly T[]): T[][] {
  const cut: T[][] = [[]];
  let size = 0;
  for (const item of items) {
    const chars = JSON.stringify(item).length;
    if (size > 0 && size + chars > PIECE_CHARS) {
      cut.push([]);
      size = 0;
    }
    cut.at(-1)!.push(item);
    size += chars;
  }
  return cut;
}

/** Typed by hand or read aloud: 32 characters, none that reads as another. */
const CODE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newJoinCode = () => Array.from(randomBytes(6), (b) => CODE_CHARACTERS[b % 32]).join('');
const digest = (text: string) => createHash('sha256').update(text).digest();
/** In constant time, whatever the two lengths. */
const sameCode = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/**
 * Addresses whose wrong codes are counted in one window. Past that nobody new is read until the
 * next: a guesser with many addresses is held to the same few tries a minute, and the count to a
 * size.
 */
const CODE_ADDRESSES = 1024;

const PING = encode({ kind: 'ping' });

export interface HostOptions {
  appVersion: string;
  /** Whether a guest needs a code: on a direct connection, whose transport is no gate. */
  joinCode?: boolean;
  /** The host's own name in the lobby. */
  name?: string;
  /**
   * The lobby changed, a guest's command changed the league, or the session closed: what the
   * host's window did not ask for itself, and refetches on.
   */
  onChange?: () => void;
}

interface Guest {
  /** His place in the host's list for the whole session: the host's own number, whatever his connection. */
  readonly key: string;
  /** Opens this place again from a new connection, inside this session. */
  readonly resumeKey: string;
  /** Text for the list: his own word, never used to decide anything. */
  name: string;
  /** The team the host seated him on. */
  teamId: TeamId | null;
  /** The team he asked for: a wish, which only the host's `seat` answers. */
  wish: TeamId | null;
  /** Done for now, by his own word: advisory, and never while he is away. */
  ready: boolean;
  /** What the host granted him. */
  can: Grant[];
  /** His commands in the league's queue. */
  waiting: number;
  /** Null while he is away: a seat waits for its GM. */
  connection: Connection | null;
  /** Saved batches go to him: from the answer to the `resync` of this connection. */
  live: boolean;
  /** Pings sent since he was last heard. */
  missed: number;
  /** When a `resync` of this connection was last answered. */
  syncedAt: number;
}

/** A guest as the lobby shows him to everyone: without the host's key for him. */
const row = ({ name, teamId, wish, connection, ready, can }: Guest): Peer => ({
  name,
  teamId,
  wish,
  connected: connection !== null,
  ready,
  can,
});

/**
 * The host's side of a hosted league. The league stays what it was: one `LeagueService` over the
 * host's save, the only place a command runs. This session lets guests in (versions, join code),
 * sends each one who asks the save as rows, or the batches he missed, and then every batch of
 * events the league saves, and runs the commands they send as the actor the host's own seat table
 * gives them. A seated guest who drops keeps his place: his resume key opens it again.
 *
 * Nothing a guest sends is acted on before `decode` has passed it. A message that fails, or a
 * limit of `WIRE` broken, ends that guest's connection and nothing else.
 */
export class HostSession {
  readonly id = randomBytes(8).toString('hex');
  /**
   * What a guest types to get in where the transport itself is no gate; null where it is one.
   * A kick makes a new one.
   */
  joinCode: string | null;
  private readonly guests = new Map<string, Guest>();
  /** The host's own row: his team as the session began (the first, when he plays several), his Ready. */
  private readonly home: TeamId | null;
  private hostReady = false;
  /** Wrong codes by address (the transport's `peerKey`), in the window that began at `wrongSince`. */
  private readonly wrong = new Map<string, number>();
  private wrongSince = 0;
  private admitted = 0;
  /** The request each guest's command answers, by the actor it ran as (`onPersisted` hands it back). */
  private readonly asked = new WeakMap<Actor, { guest: Guest; requestId: number }>();
  /**
   * The last `events` packets, oldest first and with no gap up to where the league stands: what a
   * guest who missed some is sent again. At most `WIRE.replayBytes` of them.
   */
  private readonly sent: { seq: number; packet: Buffer }[] = [];
  private sentBytes = 0;
  private heart?: ReturnType<typeof setInterval>;
  private over = false;

  private constructor(
    private readonly league: LeagueService,
    private readonly transport: HostTransport,
    private readonly options: HostOptions,
  ) {
    this.joinCode = options.joinCode ? newJoinCode() : null;
    this.home = league.listTeams().find((t) => t.userControlled)?.id ?? null;
  }

  /**
   * Opens `league` to guests. Refused, saying why, while a GM is out of work (a fired GM is one
   * slot for the whole league: two guests could not be told apart) and when the save holds a
   * string the wire refuses. "Can be fired" is turned off, and stays off in the save (and off
   * while the session is open, for the commands that come through `dispatch`).
   */
  static async start(
    league: LeagueService,
    transport: HostTransport,
    options: HostOptions,
  ): Promise<HostSession> {
    const session = new HostSession(league, transport, options);
    const { career, canBeFired } = league.status();
    if (career) throw new Error('Cannot host while a GM is out of work.');
    // The guard every guest will run on these rows: better refused here than at each join.
    for (const message of session.snapshot()) {
      try {
        parseMessage('host', message);
      } catch {
        const where = message.kind === 'snapshot.rows' ? `table ${message.table}` : 'the save';
        throw new Error(`Cannot host: ${where} holds a name the game cannot send.`);
      }
    }
    if (canBeFired) {
      const off = await league.dispatch({ kind: 'league.setCanBeFired', on: false });
      if (!off.ok) throw new Error(off.error.message);
    }
    league.onPersisted = (events, seq, actor) => {
      try {
        session.broadcast(events, seq, actor);
        session.noted(events, actor);
      } catch (err) {
        // The batch is saved; what could not be sent (an event that outgrew a packet) ends the
        // session, not the host's own command.
        console.warn('[net] closing the session:', (err as Error).message);
        session.close('error');
      }
    };
    transport.listen((connection) => session.accept(connection));
    session.heart = setInterval(() => session.beat(), WIRE.pingMs);
    return session;
  }

  /** The guests, for the host's list: the connected ones, and the seated ones who dropped. */
  list() {
    return [...this.guests.values()].map((guest) => ({ key: guest.key, ...row(guest) }));
  }

  /** The lobby: the host, then his guests, each with the key the host's tools take. */
  peers(): SessionPeer[] {
    return [this.me(), ...this.list()];
  }

  /**
   * The host's own row. His team is his while it is a human one that he seated no guest on, and
   * the clock is always his.
   */
  private me(): Peer {
    const { home } = this;
    const mine =
      home !== null &&
      this.human(home) &&
      ![...this.guests.values()].some((g) => g.teamId === home);
    return {
      name: this.options.name ?? 'Host',
      teamId: mine ? home : null,
      wish: null,
      connected: true,
      ready: this.hostReady,
      can: ['advance'],
    };
  }

  /** The lobby changed: every guest is sent it, with his own row's number, and the host's window is told. */
  private announce() {
    if (this.over) return;
    const guests = [...this.guests.values()];
    const peers = [this.me(), ...guests.map(row)];
    for (const [i, guest] of guests.entries())
      this.send(guest, encode({ kind: 'session', you: i + 1, peers }));
    this.options.onChange?.();
  }

  /**
   * Binds a guest to a team, or to none: only the host does, a guest can only wish. An AI team
   * becomes a human one first, by the same command as in single-player. Unseating a guest who is
   * away forgets him: that is how his team is freed for someone else.
   */
  async seat(key: string, teamId: TeamId | null) {
    if (!this.guests.has(key)) throw new Error('No such guest.');
    if (teamId !== null && !this.human(teamId)) {
      const made = await this.league.dispatch({
        kind: 'team.setUserControlled',
        teamId,
        userControlled: true,
      });
      if (!made.ok) throw new Error(made.error.message);
    }
    // After the wait: he may have left, and another call may have filled the seat.
    const guest = this.guests.get(key);
    if (!guest) throw new Error('No such guest.');
    if (
      teamId !== null &&
      [...this.guests.values()].some((g) => g !== guest && g.teamId === teamId)
    )
      throw new Error('That team has a GM.');
    guest.teamId = teamId;
    guest.wish = null;
    if (teamId === null && !guest.connection) this.guests.delete(key);
    this.announce();
  }

  /** Lets a guest move the clock (a co-commissioner), or takes that back. */
  grant(key: string, on: boolean) {
    const guest = this.guests.get(key);
    if (!guest) throw new Error('No such guest.');
    guest.can = on ? ['advance'] : [];
    this.announce();
  }

  /** The host's own Ready. */
  ready(on: boolean) {
    this.hostReady = on;
    this.announce();
  }

  /**
   * Puts a guest out. His place is forgotten, so his resume key opens nothing and a command of
   * his still waiting runs for no team; the join code he knows is replaced; his connection is
   * told why and closed. The others' resume keys still stand in for the code.
   */
  kick(key: string) {
    const guest = this.guests.get(key);
    if (!guest) throw new Error('No such guest.');
    this.guests.delete(key);
    guest.teamId = null;
    guest.can = [];
    if (this.joinCode !== null) this.joinCode = newJoinCode();
    this.send(guest, encode({ kind: 'bye', reason: 'kicked' }));
    const { connection } = guest;
    guest.connection = null;
    guest.live = false;
    connection?.close();
    this.announce();
  }

  /**
   * The host's own command, from his window. "Can be fired" cannot be turned on while the session
   * is open (a fired GM is one slot for the whole league); everything else runs as it always did.
   */
  async dispatch(input: unknown): Promise<CommandResult> {
    const parsed = parseCommand(input);
    if (!parsed.ok) return parsed;
    const { command } = parsed;
    if (command.kind === 'league.setCanBeFired' && command.on)
      return {
        ok: false,
        error: { code: 'not_allowed', message: 'not while hosting an online league' },
      };
    const result = await this.league.dispatch(command);
    if (result.ok) this.ran(command);
    return result;
  }

  /** A command ran. One that moves the clock clears every Ready: there is a new day to look at. */
  private ran(command: Command) {
    if (!CLOCK_COMMANDS.has(command.kind)) return;
    const guests = [...this.guests.values()];
    if (!this.hostReady && !guests.some((g) => g.ready)) return;
    this.hostReady = false;
    for (const guest of guests) guest.ready = false;
    this.announce();
  }

  /**
   * A saved batch, read for the lobby. An event of another GM's command that names a GM's team
   * (an offer just arrived) clears his Ready; and a guest's command changed the league without
   * the host's window asking.
   */
  private noted(events: LeagueEvent[], actor?: Actor) {
    const author = actor && this.asked.get(actor)?.guest;
    const named = new Set(events.flatMap((e) => e.teamIds));
    let cleared = false;
    for (const guest of this.guests.values()) {
      if (guest === author || !guest.ready) continue;
      if (guest.teamId === null || !named.has(guest.teamId)) continue;
      guest.ready = false;
      cleared = true;
    }
    if (author && this.hostReady) {
      const mine = this.me().teamId;
      if (mine !== null && named.has(mine)) {
        this.hostReady = false;
        cleared = true;
      }
    }
    if (cleared) this.announce();
    else if (author) this.options.onChange?.();
  }

  /** Whether the session is over: the host closed it, or it closed itself on an error. */
  get closed() {
    return this.over;
  }

  /** Ends the session for everyone: the league is its host's alone again. */
  close(reason = 'closed') {
    if (this.over) return;
    this.over = true;
    clearInterval(this.heart);
    delete this.league.onPersisted;
    this.transport.close();
    for (const guest of this.guests.values()) {
      guest.teamId = null; // a command of his still waiting runs for no team
      this.send(guest, encode({ kind: 'bye', reason }));
      guest.connection?.close();
    }
    this.guests.clear();
    this.options.onChange?.();
  }

  /**
   * A packet to a guest, unless he is away. One whose connection already holds too much unsent is
   * dropped instead: he asks for what he missed when he is back.
   *
   * ponytail: a snapshot goes out in one turn, so a save past `WIRE.backlogBytes` deflated (some
   * 80 seasons at 16 teams) could not be sent at all. Pacing it by `unsent` is the upgrade.
   */
  private send(guest: Guest, packet: Uint8Array) {
    const { connection } = guest;
    if (!connection) return;
    if (connection.unsent + packet.length > WIRE.backlogBytes) connection.close();
    else connection.send(packet);
  }

  /** The heartbeat: a guest who let `WIRE.missedPings` pings go by without a word is gone. */
  private beat() {
    for (const guest of this.guests.values()) {
      if (guest.missed++ < WIRE.missedPings) this.send(guest, PING);
      else guest.connection?.close();
    }
  }

  private human(teamId: TeamId) {
    return this.league.listTeams().some((t) => t.id === teamId && t.userControlled);
  }

  private accept(connection: Connection) {
    let guest: Guest | undefined;
    // What comes before anything is read: the rate, and a `hello` in time.
    let allowance: number = WIRE.rate.burst;
    let heard = Date.now();
    const late = setTimeout(() => connection.close(), WIRE.helloMs);
    connection.onPacket = (packet) => {
      try {
        const now = Date.now();
        const earned = ((now - heard) * WIRE.rate.perSecond) / 1000;
        allowance = Math.min(WIRE.rate.burst, allowance + earned) - 1;
        heard = now;
        if (allowance < 0) throw new Error('too many messages');
        if (guest) {
          guest.missed = 0;
          this.receive(guest, decode('guest', packet));
        } else {
          const hello = decode('guest', packet, WIRE.helloBytes);
          if (hello.kind !== 'hello') throw new Error('`hello` comes first');
          guest = this.admit(connection, hello);
          if (guest) clearTimeout(late);
        }
      } catch {
        // Too big, too many, not a message, or one this session cannot take: his connection's fault.
        connection.close();
      }
    };
    connection.onClose = () => {
      clearTimeout(late);
      // Never let in, or already back on another connection.
      if (guest?.connection !== connection) return;
      guest.connection = null;
      guest.live = false;
      guest.ready = false;
      // A seat waits for its GM (a command of his still in the queue runs for his team). Without
      // one there is nothing to come back to.
      if (guest.teamId === null) this.guests.delete(guest.key);
      this.announce();
    };
  }

  /**
   * The handshake: the guest is let in, or told why not. A resume key of this session gives him
   * the place he held, seat and all. He is sent the lobby, and of the league nothing until he asks
   * with `resync`.
   */
  private admit(connection: Connection, hello: Extract<GuestMessage, { kind: 'hello' }>) {
    const send = (message: HostMessage) => connection.send(encode(message));
    const key = hello.resumeKey;
    const back =
      key === undefined
        ? undefined
        : [...this.guests.values()].find((g) => sameCode(g.resumeKey, key));
    const reason = this.refusal(hello, !!back, connection.peerKey);
    if (reason) {
      send({ kind: 'refused', reason });
      connection.close();
      return undefined;
    }
    // The connection he held, if the host has not seen it go yet.
    back?.connection?.close();
    const fresh = {
      connection,
      name: hello.name,
      ready: false,
      live: false,
      missed: 0,
      syncedAt: -Infinity,
    };
    const guest: Guest = back
      ? Object.assign(back, fresh)
      : {
          key: String(++this.admitted),
          resumeKey: randomBytes(16).toString('hex'),
          teamId: null,
          wish: null,
          can: [],
          waiting: 0,
          ...fresh,
        };
    this.guests.set(guest.key, guest);
    const { rulesetId, sport } = this.league.head();
    send({ kind: 'welcome', sessionId: this.id, rulesetId, sport, resumeKey: guest.resumeKey });
    this.announce();
    return guest;
  }

  /**
   * Why this guest is not let in, or null: his build must be the host's, and he must hold the
   * code, or the resume key of a place in this session (`back`), which stands in for it.
   */
  private refusal(hello: Extract<GuestMessage, { kind: 'hello' }>, back: boolean, address: string) {
    if (this.over) return 'closed';
    if (hello.protocol !== WIRE.protocol) return 'protocol';
    if (hello.appVersion !== this.options.appVersion) return 'appVersion';
    if (hello.saveSchema !== SAVE_SCHEMA) return 'saveSchema';
    if (back) return null;
    const code = this.joinCode;
    if (code !== null && !this.holds(hello.joinCode ?? '', code, address)) return 'joinCode';
    if (this.guests.size >= WIRE.guests) return 'full';
    return null;
  }

  /**
   * Whether a newcomer's code is the session's. An address that sent `WIRE.codeTries` wrong ones
   * in this window of `WIRE.codeTriesMs` is not read again before the next, right code or wrong.
   *
   * ponytail: one window for every address, begun by the first `hello` after the last one ended,
   * so a guesser gets up to twice the tries across its edge. A window per address is the upgrade.
   */
  private holds(given: string, code: string, address: string) {
    const now = Date.now();
    if (now - this.wrongSince >= WIRE.codeTriesMs) {
      this.wrong.clear();
      this.wrongSince = now;
    }
    const tries = this.wrong.get(address) ?? 0;
    if (tries >= WIRE.codeTries || this.wrong.size >= CODE_ADDRESSES) return false;
    if (sameCode(given, code)) return true;
    this.wrong.set(address, tries + 1);
    return false;
  }

  /**
   * Brings a guest's mirror to where the league stands, and puts him on the broadcast list in the
   * same turn, between two commands: every batch saved after this follows on his connection. From
   * `seq` on he is sent the batches he missed, if the buffer still holds them (a batch of none
   * when he missed none: the answer always starts at his number); if not, or with no `seq`, the
   * whole save. Either can be megabytes for a message of a few bytes, so one connection is
   * answered once in `WIRE.resyncEveryMs`: asking sooner breaks a limit like any other.
   */
  private sync(guest: Guest, seq?: number) {
    const now = Date.now();
    if (now - guest.syncedAt < WIRE.resyncEveryMs) throw new Error('resync too often');
    guest.syncedAt = now;
    const head = this.league.head().seq;
    const from = seq === head ? this.sent.length : this.sent.findIndex((m) => m.seq === seq);
    if (from >= 0) {
      for (const { packet } of this.sent.slice(from)) this.send(guest, packet);
      if (seq === head) this.send(guest, encode({ kind: 'events', seq, events: [], last: true }));
    } else {
      for (const message of this.snapshot()) this.send(guest, encode(message));
    }
    guest.live = true;
  }

  /** The whole save as messages. */
  private snapshot(): HostMessage[] {
    const { seq, tables } = this.league.snapshot();
    return [
      { kind: 'snapshot.begin' },
      ...tables.flatMap(({ table, rows }) =>
        pieces(rows).map((piece) => ({ kind: 'snapshot.rows' as const, table, rows: piece })),
      ),
      {
        kind: 'snapshot.end',
        seq,
        counts: Object.fromEntries(tables.map((t) => [t.table, t.rows.length])),
      },
    ];
  }

  private receive(guest: Guest, message: GuestMessage) {
    switch (message.kind) {
      case 'command':
        void this.run(guest, message.requestId, message.command);
        return;
      case 'resync':
        return this.sync(guest, message.seq);
      case 'hello':
        throw new Error('hello twice');
      case 'seat.request':
        // A wish, kept if the team is one of the league's: the host decides.
        if (guest.wish === message.teamId) return;
        if (!this.league.listTeams().some((t) => t.id === message.teamId)) return;
        guest.wish = message.teamId;
        return this.announce();
      case 'ready':
        if (guest.ready === message.on) return;
        guest.ready = message.on;
        return this.announce();
      default:
      // A `pong` has said all it says by arriving.
    }
  }

  /** A guest's command, through the same queue as the host's own, answered to him alone. */
  private async run(guest: Guest, requestId: number, command: Command) {
    const reject = (error: CommandError) => {
      const message = error.message.slice(0, 500);
      this.send(guest, encode({ kind: 'rejected', requestId, error: { ...error, message } }));
    };
    // Refused, not queued: a guest cannot pile work on the league.
    if (guest.waiting >= WIRE.waitingCommands)
      return reject({ code: 'invalid', message: 'too many commands waiting' });
    guest.waiting++;
    try {
      const result = await this.league.dispatch(command, () => {
        // Who he is comes from his connection and what he holds from this table, never from his
        // message. The team must still be a human one: a GM who handed his to its AI GM, or whose
        // team the host took back, holds nothing.
        const { teamId } = guest;
        const actor: Actor = {
          id: `peer:${guest.key}`, // never `local`
          controls: teamId !== null && this.human(teamId) ? [teamId] : [],
          can: [...guest.can],
        };
        this.asked.set(actor, { guest, requestId });
        return actor;
      });
      if (result.ok) this.ran(command);
      else reject(result.error);
    } catch {
      // Not the engine's refusal: the sim thread died or the save failed. Its text stays here.
      reject({ code: 'invalid', message: 'the host could not run this command' });
    } finally {
      guest.waiting--;
    }
  }

  /**
   * A saved batch, to every guest on the broadcast list, in pieces that each fit a packet, and
   * into the buffer. The guest whose command it was gets his request id on the last piece.
   */
  private broadcast(events: LeagueEvent[], seq: number, actor?: Actor) {
    if (this.guests.size === 0) {
      // Nobody is there to miss it. The buffer starts again with the next guest, so it never has
      // a gap: one who was here before finds no packet at his older count, and takes the save.
      this.sent.length = 0;
      this.sentBytes = 0;
      return;
    }
    const asked = actor && this.asked.get(actor);
    const cut = pieces(events);
    let at = seq;
    for (const [i, piece] of cut.entries()) {
      const message = {
        kind: 'events' as const,
        seq: at,
        events: piece,
        last: i === cut.length - 1,
      };
      const packet = encode(message);
      this.sent.push({ seq: at, packet });
      this.sentBytes += packet.length;
      at += piece.length;
      for (const guest of this.guests.values()) {
        if (!guest.live) continue;
        const his = message.last && guest === asked?.guest;
        this.send(guest, his ? encode({ ...message, requestId: asked.requestId }) : packet);
      }
    }
    while (this.sentBytes > WIRE.replayBytes) this.sentBytes -= this.sent.shift()!.packet.length;
  }
}
