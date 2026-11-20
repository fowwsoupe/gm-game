import { SAVE_SCHEMA } from '@gm/data';
import {
  WIRE,
  type Command,
  type CommandResult,
  type GuestMessage,
  type HostMessage,
  type LeagueEvent,
  type TableRows,
} from '@gm/shared';
import { defaultContext } from '@gm/sim';
import type { LeagueService } from '../league';
import { encode, unpack } from './codec';
import type { Connection, GuestTransport } from './transport';

/** Whether this build has the rules a league runs on: the mirror's queries read them. */
function knows(rulesetId: string, sport: string) {
  try {
    return defaultContext(rulesetId).ruleset.sport === sport;
  } catch {
    return false;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * A guest's side of a hosted league. The mirror is a league service with an in-memory save: this
 * session fills it from the host's snapshot, feeds it the host's events, and sends the host every
 * command the mirror's `dispatch` is given. The sim never runs here, and the player's own save is
 * not opened.
 *
 * Nothing the host sends is acted on before `unpack` has passed it, and a message that fails ends
 * the session. A gap does not: a batch out of step has the host send again what was missed, a
 * batch the mirror cannot apply has it send the whole league again (once: a second one in a row
 * ends the session), and a connection that drops is opened again, with the resume key that gives
 * this guest his seat back.
 */
export class GuestSession {
  private readonly end = deferred<string>();
  /** Settles when the session is over, with the reason. The mirror stays readable until disposed. */
  readonly ended = this.end.promise;
  private over = false;
  private readonly joined = deferred<void>();
  /** The mirror has held the league once: from then on a drop is a wait, not the end. */
  private up = false;
  private connection: Connection | null = null;
  /** The host's last `welcome`, and whether it came on this connection: no command goes out before. */
  private welcome: Extract<HostMessage, { kind: 'welcome' }> | null = null;
  private greeted = false;
  /** The event count after the last whole batch taken in; null when the mirror must be sent whole. */
  private at: number | null = null;
  /** A `resync` is out: a batch that does not start at `at` is from before its answer. */
  private syncing = false;
  /** Goes up when the mirror is given up on: a batch handed to it before that fails unheard. */
  private epoch = 0;
  /** Batches in a row the mirror could not apply. */
  private failures = 0;
  /** Tries to get back in since the host last let this guest in. */
  private tries = 0;
  private again?: ReturnType<typeof setTimeout>;
  /** The pieces of the snapshot coming in, and the bytes they inflated to. */
  private rows: { tables: TableRows[]; bytes: number } | null = null;
  /** The pieces so far of a batch whose last has not come. */
  private batch: { seq: number; events: LeagueEvent[]; bytes: number } | null = null;
  private requests = 0;
  private readonly waiting = new Map<
    number,
    { resolve: (result: CommandResult) => void; reject: (err: Error) => void }
  >();

  private constructor(
    private readonly mirror: LeagueService,
    private readonly transport: GuestTransport,
    private readonly options: { appVersion: string; name: string; joinCode?: string },
  ) {
    mirror.forward = (command) => this.ask(command);
  }

  /**
   * Joins the league hosted at the other end of `transport`, with `mirror` (a service made with
   * ':memory:') as this machine's copy. Resolves once the snapshot is in; a refusal, with the
   * host's reason, or a drop before that is the join's failure.
   */
  static async join(
    mirror: LeagueService,
    transport: GuestTransport,
    options: { appVersion: string; name: string; joinCode?: string },
  ): Promise<GuestSession> {
    const session = new GuestSession(mirror, transport, options);
    await session.connect();
    const failed = session.ended.then((reason) => Promise.reject(new Error(reason)));
    await Promise.race([session.joined.promise, failed]);
    return session;
  }

  leave() {
    this.stop('left');
  }

  /** A connection to the host and this guest's `hello` on it: the first, and each one after a drop. */
  private async connect() {
    const connection = await this.transport.connect();
    if (this.over) return connection.close();
    this.connection = connection;
    this.greeted = false;
    // As long with no word from the host as the host gives a guest: the connection is dead.
    const quiet = setTimeout(() => connection.close(), WIRE.pingMs * WIRE.missedPings);
    connection.onPacket = (packet) => {
      quiet.refresh();
      try {
        this.receive(unpack('host', packet));
      } catch (err) {
        this.stop((err as Error).message);
      }
    };
    connection.onClose = () => {
      clearTimeout(quiet);
      if (connection === this.connection) this.dropped();
    };
    const { appVersion, name, joinCode } = this.options;
    this.send({
      kind: 'hello',
      protocol: WIRE.protocol,
      appVersion,
      saveSchema: SAVE_SCHEMA,
      name,
      ...(joinCode !== undefined && { joinCode }),
      ...(this.welcome && { resumeKey: this.welcome.resumeKey }),
    });
  }

  private send(message: GuestMessage) {
    this.connection?.send(encode(message));
  }

  /** Over, for the first reason given: the connection closes and every command still waiting fails. */
  private stop(reason: string) {
    if (this.over) return;
    this.over = true;
    clearTimeout(this.again);
    this.connection?.close();
    this.forget();
    this.end.resolve(reason);
  }

  /**
   * The connection went with no goodbye. Before the league was ever in, that is the join's
   * failure. After, the commands waiting fail and the session tries to get back in, a ping apart,
   * `WIRE.rejoinTries` times.
   */
  private dropped() {
    if (this.over) return;
    this.connection = null;
    this.greeted = false;
    this.batch = null;
    this.rows = null;
    this.forget();
    if (!this.up || this.tries++ >= WIRE.rejoinTries) return this.stop('disconnected');
    this.again = setTimeout(() => void this.connect().catch(() => this.dropped()), WIRE.pingMs);
  }

  /** A command is sent once: its answer will not come on another connection. */
  private forget() {
    for (const { reject } of this.waiting.values()) reject(new Error('disconnected'));
    this.waiting.clear();
  }

  /** A command to the host, sent once: its answer, or "disconnected" if the connection goes first. */
  private ask(command: Command): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      // Not before `welcome`: the `resync` sent on it must reach the host first, so that the answer
      // comes after what this mirror missed.
      if (this.over || !this.greeted) return reject(new Error('disconnected'));
      const requestId = ++this.requests;
      const packet = encode({ kind: 'command', requestId, command });
      this.waiting.set(requestId, { resolve, reject });
      this.connection?.send(packet);
    });
  }

  private answer(requestId: number, result: CommandResult) {
    this.waiting.get(requestId)?.resolve(result);
    this.waiting.delete(requestId);
  }

  /** Asks the host for what this mirror lacks: the batches from `at` on, or the whole league. */
  private resync() {
    this.syncing = true;
    this.send({ kind: 'resync', ...(this.at !== null && { seq: this.at }) });
  }

  /**
   * The mirror could not apply a batch (it stands where its save does): it is given up on and
   * asked for whole. A second batch in a row is not a gap any more, and ends the session.
   */
  private failed(err: Error) {
    this.epoch++;
    this.at = null;
    this.batch = null;
    if (++this.failures > 1) return this.stop(`the mirror cannot follow the host: ${err.message}`);
    this.resync();
  }

  private receive({ message, bytes }: { message: HostMessage; bytes: number }) {
    switch (message.kind) {
      case 'refused':
        return this.stop(`refused: ${message.reason}`);
      case 'welcome':
        if (!knows(message.rulesetId, message.sport)) return this.stop('unknown ruleset');
        // Another session's league is not this mirror's, whatever its event count.
        if (message.sessionId !== this.welcome?.sessionId) this.at = null;
        this.welcome = message;
        this.greeted = true;
        this.tries = 0;
        return this.resync();
      case 'snapshot.begin':
        this.epoch++; // a batch still on its way into the mirror is from before these rows
        this.batch = null;
        this.rows = { tables: [], bytes: 0 };
        return;
      case 'snapshot.rows':
        if (!this.rows) throw new Error('rows outside a snapshot');
        if ((this.rows.bytes += bytes) > WIRE.snapshotBytes) throw new Error('snapshot too big');
        this.rows.tables.push(message);
        return;
      case 'snapshot.end': {
        if (!this.rows || !this.welcome) throw new Error('no snapshot to end');
        this.mirror.restore(this.rows.tables, message.counts);
        this.rows = null;
        // The rows must be the league the host said it was sending.
        const { seq, rulesetId, sport } = this.mirror.head();
        if (
          seq !== message.seq ||
          rulesetId !== this.welcome.rulesetId ||
          sport !== this.welcome.sport
        )
          throw new Error('the snapshot is not the league it was said to be');
        this.at = seq;
        this.syncing = false;
        this.up = true;
        this.joined.resolve();
        return;
      }
      case 'events': {
        const { requestId } = message;
        const expected = this.batch ? this.batch.seq + this.batch.events.length : this.at;
        if (message.seq !== expected) {
          // A piece is missing, or this one is from before the answer to a `resync`: the pieces
          // held are let go and the host is asked, once, for all from `at` on. A command of this
          // guest's that these events answer did run: they reach the mirror with the rest.
          this.batch = null;
          if (!this.syncing) this.resync();
          if (requestId !== undefined) this.answer(requestId, { ok: true, events: [] });
          return;
        }
        this.syncing = false;
        // A long batch comes in pieces, applied in one go once the last is in: the mirror only
        // ever stands where the host's own league stood, between two commands.
        const batch = (this.batch ??= { seq: message.seq, events: [], bytes: 0 });
        if ((batch.bytes += bytes) > WIRE.batchBytes) throw new Error('batch too big');
        for (const event of message.events) batch.events.push(event);
        if (!message.last) return;
        this.batch = null;
        this.at = batch.seq + batch.events.length;
        const { epoch } = this;
        // The mirror's own queue keeps the batches in order. A command's answer waits for its
        // events to be applied, as a local one's does: screens refetch straight away.
        void this.mirror
          .applyRemote(batch.events, batch.seq)
          .then(
            () => {
              if (epoch === this.epoch) this.failures = 0;
            },
            (err: Error) => {
              if (epoch === this.epoch) this.failed(err);
            },
          )
          .then(() => {
            if (requestId !== undefined) this.answer(requestId, { ok: true, events: batch.events });
          });
        return;
      }
      case 'rejected':
        return this.answer(message.requestId, { ok: false, error: message.error });
      case 'ping':
        return this.send({ kind: 'pong' });
      case 'bye':
        return this.stop(message.reason);
      default:
      // The peer list: a good message nothing reads yet.
    }
  }
}
