import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SAVE_SCHEMA } from '@gm/data';
import {
  parseMessage,
  WIRE,
  type Actor,
  type Command,
  type CommandError,
  type GuestMessage,
  type HostMessage,
  type LeagueEvent,
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

const PING = encode({ kind: 'ping' });

interface Guest {
  /** His place in the host's list for the whole session: the host's own number, whatever his connection. */
  readonly key: string;
  /** Opens this place again from a new connection, inside this session. */
  readonly resumeKey: string;
  /** Text for the list: his own word, never used to decide anything. */
  name: string;
  /** The team the host seated him on. */
  teamId: TeamId | null;
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
  /** What a guest types to get in where the transport itself is no gate; null where it is one. */
  readonly joinCode: string | null;
  private readonly guests = new Map<string, Guest>();
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
    private readonly appVersion: string,
    joinCode: boolean,
  ) {
    this.joinCode = joinCode ? newJoinCode() : null;
  }

  /**
   * Opens `league` to guests. Refused, saying why, while a GM is out of work (a fired GM is one
   * slot for the whole league: two guests could not be told apart) and when the save holds a
   * string the wire refuses. "Can be fired" is turned off, and stays off in the save.
   */
  static async start(
    league: LeagueService,
    transport: HostTransport,
    options: { appVersion: string; joinCode?: boolean },
  ): Promise<HostSession> {
    const session = new HostSession(league, transport, options.appVersion, !!options.joinCode);
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
    return [...this.guests.values()].map(({ key, name, teamId, connection }) => ({
      key,
      name,
      teamId,
      connected: connection !== null,
    }));
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
    if (teamId === null && !guest.connection) this.guests.delete(key);
  }

  /** Ends the session for everyone: the league is its host's alone again. */
  close(reason = 'closed') {
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
      // A seat waits for its GM (a command of his still in the queue runs for his team). Without
      // one there is nothing to come back to.
      if (guest.teamId === null) this.guests.delete(guest.key);
    };
  }

  /**
   * The handshake: the guest is let in, or told why not. A resume key of this session gives him
   * the place he held, seat and all. He is sent nothing more until he asks with `resync`.
   */
  private admit(connection: Connection, hello: Extract<GuestMessage, { kind: 'hello' }>) {
    const send = (message: HostMessage) => connection.send(encode(message));
    const key = hello.resumeKey;
    const back =
      key === undefined
        ? undefined
        : [...this.guests.values()].find((g) => sameCode(g.resumeKey, key));
    const reason = this.refusal(hello, !!back);
    if (reason) {
      send({ kind: 'refused', reason });
      connection.close();
      return undefined;
    }
    // The connection he held, if the host has not seen it go yet.
    back?.connection?.close();
    const fresh = { connection, name: hello.name, live: false, missed: 0, syncedAt: -Infinity };
    const guest: Guest = back
      ? Object.assign(back, fresh)
      : {
          key: String(++this.admitted),
          resumeKey: randomBytes(16).toString('hex'),
          teamId: null,
          waiting: 0,
          ...fresh,
        };
    this.guests.set(guest.key, guest);
    const { rulesetId, sport } = this.league.head();
    send({ kind: 'welcome', sessionId: this.id, rulesetId, sport, resumeKey: guest.resumeKey });
    return guest;
  }

  /**
   * Why this guest is not let in, or null: his build must be the host's, and he must hold the
   * code, or the resume key of a place in this session (`back`), which stands in for it.
   */
  private refusal(hello: Extract<GuestMessage, { kind: 'hello' }>, back: boolean) {
    if (this.over) return 'closed';
    if (hello.protocol !== WIRE.protocol) return 'protocol';
    if (hello.appVersion !== this.appVersion) return 'appVersion';
    if (hello.saveSchema !== SAVE_SCHEMA) return 'saveSchema';
    if (back) return null;
    if (this.joinCode !== null && !sameCode(hello.joinCode ?? '', this.joinCode)) return 'joinCode';
    if (this.guests.size >= WIRE.guests) return 'full';
    return null;
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
      default:
      // A `pong` has said all it says by arriving. A wish for a seat and `ready`: good messages
      // nothing answers yet.
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
        };
        this.asked.set(actor, { guest, requestId });
        return actor;
      });
      if (!result.ok) reject(result.error);
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
