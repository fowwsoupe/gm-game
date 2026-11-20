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

interface Guest {
  connection: Connection;
  /** Text for the list: his own word, never used to decide anything. */
  name: string;
  /** The team the host seated him on. */
  teamId: TeamId | null;
}

/**
 * The host's side of a hosted league. The league stays what it was: one `LeagueService` over the
 * host's save, the only place a command runs. This session lets guests in (versions, join code),
 * sends each one the save as rows and then every batch of events the league saves, and runs the
 * commands they send as the actor the host's own seat table gives them.
 *
 * Nothing a guest sends is acted on before `decode` has passed it, and a message that fails ends
 * that guest's connection and nothing else.
 */
export class HostSession {
  readonly id = randomBytes(8).toString('hex');
  /** What a guest types to get in where the transport itself is no gate; null where it is one. */
  readonly joinCode: string | null;
  private readonly guests = new Map<string, Guest>();
  /** The request each guest's command answers, by the actor it ran as (`onPersisted` hands it back). */
  private readonly asked = new WeakMap<Actor, { guest: Guest; requestId: number }>();

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
    return session;
  }

  /** Who is connected, for the host's list. */
  list() {
    return [...this.guests].map(([key, { name, teamId }]) => ({ key, name, teamId }));
  }

  /**
   * Binds a guest to a team, or to none: only the host does, a guest can only wish. An AI team
   * becomes a human one first, by the same command as in single-player.
   */
  async seat(peerKey: string, teamId: TeamId | null) {
    if (!this.guests.has(peerKey)) throw new Error('No such guest.');
    if (teamId !== null && !this.human(teamId)) {
      const made = await this.league.dispatch({
        kind: 'team.setUserControlled',
        teamId,
        userControlled: true,
      });
      if (!made.ok) throw new Error(made.error.message);
    }
    // After the wait: he may have left, and another call may have filled the seat.
    const guest = this.guests.get(peerKey);
    if (!guest) throw new Error('No such guest.');
    if (
      teamId !== null &&
      [...this.guests.values()].some((g) => g !== guest && g.teamId === teamId)
    )
      throw new Error('That team has a GM.');
    guest.teamId = teamId;
  }

  /** Ends the session for everyone: the league is its host's alone again. */
  close(reason = 'closed') {
    delete this.league.onPersisted;
    this.transport.close();
    for (const guest of this.guests.values()) {
      guest.teamId = null; // a command of his still waiting runs for no team
      guest.connection.send(encode({ kind: 'bye', reason }));
      guest.connection.close();
    }
    this.guests.clear();
  }

  private human(teamId: TeamId) {
    return this.league.listTeams().some((t) => t.id === teamId && t.userControlled);
  }

  private accept(connection: Connection) {
    let guest: Guest | undefined;
    connection.onPacket = (packet) => {
      try {
        const message = decode('guest', packet);
        if (guest) this.receive(guest, message);
        else if (message.kind === 'hello') guest = this.admit(connection, message);
        else connection.close(); // `hello` comes first
      } catch {
        // Too big, not a message, or one this session cannot take: his connection's fault.
        connection.close();
      }
    };
    connection.onClose = () => {
      if (!guest) return;
      // His seat goes with him: a command of his still waiting runs for no team.
      guest.teamId = null;
      if (this.guests.get(connection.peerKey) === guest) this.guests.delete(connection.peerKey);
    };
  }

  /** The handshake: the guest is let in and sent the league, or told why not. */
  private admit(connection: Connection, hello: Extract<GuestMessage, { kind: 'hello' }>) {
    const send = (message: HostMessage) => connection.send(encode(message));
    const reason = this.refusal(hello);
    if (reason) {
      send({ kind: 'refused', reason });
      connection.close();
      return undefined;
    }
    const { rulesetId, sport } = this.league.head();
    // The resume key opens nothing yet: a guest who drops joins again as a new one.
    const resumeKey = randomBytes(16).toString('hex');
    send({ kind: 'welcome', sessionId: this.id, rulesetId, sport, resumeKey });
    // The rows and his place in the list in one go, between two commands: every batch saved after
    // these rows follows them on his connection, and none from before does.
    for (const message of this.snapshot()) send(message);
    const guest: Guest = { connection, name: hello.name, teamId: null };
    this.guests.set(connection.peerKey, guest);
    return guest;
  }

  /** Why this guest is not let in, or null: his build must be the host's, and he must hold the code. */
  private refusal(hello: Extract<GuestMessage, { kind: 'hello' }>) {
    if (hello.protocol !== WIRE.protocol) return 'protocol';
    if (hello.appVersion !== this.appVersion) return 'appVersion';
    if (hello.saveSchema !== SAVE_SCHEMA) return 'saveSchema';
    if (this.joinCode !== null && !sameCode(hello.joinCode ?? '', this.joinCode)) return 'joinCode';
    if (this.guests.size >= WIRE.guests) return 'full';
    return null;
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
      case 'hello':
        throw new Error('hello twice');
      default:
      // A wish for a seat, ready, resync, pong: good messages nothing answers yet.
    }
  }

  /** A guest's command, through the same queue as the host's own, answered to him alone. */
  private async run(guest: Guest, requestId: number, command: Command) {
    const reject = (error: CommandError) => {
      const message = error.message.slice(0, 500);
      guest.connection.send(encode({ kind: 'rejected', requestId, error: { ...error, message } }));
    };
    try {
      const result = await this.league.dispatch(command, () => {
        // Who he is comes from his connection and what he holds from this table, never from his
        // message. The team must still be a human one: a GM who handed his to its AI GM, or whose
        // team the host took back, holds nothing.
        const { teamId } = guest;
        const actor: Actor = {
          id: `peer:${guest.connection.peerKey}`, // never `local`, whatever the transport calls him
          controls: teamId !== null && this.human(teamId) ? [teamId] : [],
        };
        this.asked.set(actor, { guest, requestId });
        return actor;
      });
      if (!result.ok) reject(result.error);
    } catch {
      // Not the engine's refusal: the sim thread died or the save failed. Its text stays here.
      reject({ code: 'invalid', message: 'the host could not run this command' });
    }
  }

  /**
   * A saved batch, to every guest in the list, in pieces that each fit a packet. The guest whose
   * command it was gets his request id on the last piece.
   */
  private broadcast(events: LeagueEvent[], seq: number, actor?: Actor) {
    if (this.guests.size === 0) return;
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
      at += piece.length;
      const packet = encode(message);
      for (const guest of this.guests.values()) {
        const his = message.last && guest === asked?.guest;
        guest.connection.send(his ? encode({ ...message, requestId: asked.requestId }) : packet);
      }
    }
  }
}
