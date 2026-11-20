import { SAVE_SCHEMA } from '@gm/data';
import {
  WIRE,
  type Command,
  type CommandResult,
  type HostMessage,
  type LeagueEvent,
  type TableRows,
} from '@gm/shared';
import { defaultContext } from '@gm/sim';
import type { LeagueService } from '../league';
import { decode, encode } from './codec';
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
 * Nothing the host sends is acted on before `decode` has passed it. A message that fails, a batch
 * out of step and a batch the mirror cannot apply each end the session.
 */
export class GuestSession {
  private readonly end = deferred<string>();
  /** Settles when the session is over, with the reason. The mirror stays readable until disposed. */
  readonly ended = this.end.promise;
  private over = false;
  private readonly joined = deferred<void>();
  private welcome: Extract<HostMessage, { kind: 'welcome' }> | null = null;
  /** The pieces of the snapshot coming in. */
  private rows: TableRows[] | null = null;
  /** The pieces so far of a batch whose last has not come. */
  private batch: { seq: number; events: LeagueEvent[] } | null = null;
  private requests = 0;
  private readonly waiting = new Map<
    number,
    { resolve: (result: CommandResult) => void; reject: (err: Error) => void }
  >();

  private constructor(
    private readonly mirror: LeagueService,
    private readonly connection: Connection,
  ) {
    connection.onPacket = (packet) => {
      try {
        this.receive(decode('host', packet));
      } catch (err) {
        this.stop((err as Error).message);
      }
    };
    connection.onClose = () => this.stop('disconnected');
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
    const session = new GuestSession(mirror, await transport.connect());
    const { appVersion, name, joinCode } = options;
    session.connection.send(
      encode({
        kind: 'hello',
        protocol: WIRE.protocol,
        appVersion,
        saveSchema: SAVE_SCHEMA,
        name,
        ...(joinCode !== undefined && { joinCode }),
      }),
    );
    const failed = session.ended.then((reason) => Promise.reject(new Error(reason)));
    await Promise.race([session.joined.promise, failed]);
    return session;
  }

  leave() {
    this.stop('left');
  }

  /** Over, for the first reason given: the connection closes and every command still waiting fails. */
  private stop(reason: string) {
    if (this.over) return;
    this.over = true;
    this.connection.close();
    for (const { reject } of this.waiting.values()) reject(new Error('disconnected'));
    this.waiting.clear();
    this.end.resolve(reason);
  }

  /** A command to the host, sent once: its answer, or "disconnected" if the session ends first. */
  private ask(command: Command): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      if (this.over) return reject(new Error('disconnected'));
      const requestId = ++this.requests;
      const packet = encode({ kind: 'command', requestId, command });
      this.waiting.set(requestId, { resolve, reject });
      this.connection.send(packet);
    });
  }

  private answer(requestId: number, result: CommandResult) {
    this.waiting.get(requestId)?.resolve(result);
    this.waiting.delete(requestId);
  }

  private receive(message: HostMessage) {
    switch (message.kind) {
      case 'refused':
        return this.stop(`refused: ${message.reason}`);
      case 'welcome':
        if (!knows(message.rulesetId, message.sport)) return this.stop('unknown ruleset');
        this.welcome = message;
        return;
      case 'snapshot.begin':
        this.rows = [];
        return;
      case 'snapshot.rows':
        if (!this.rows) throw new Error('rows outside a snapshot');
        this.rows.push(message);
        return;
      case 'snapshot.end': {
        if (!this.rows || !this.welcome) throw new Error('no snapshot to end');
        this.mirror.restore(this.rows, message.counts);
        this.rows = null;
        // The rows must be the league the host said it was sending.
        const { seq, rulesetId, sport } = this.mirror.head();
        if (
          seq !== message.seq ||
          rulesetId !== this.welcome.rulesetId ||
          sport !== this.welcome.sport
        )
          throw new Error('the snapshot is not the league it was said to be');
        this.joined.resolve();
        return;
      }
      case 'events': {
        // A long batch comes in pieces, applied in one go once the last is in: the mirror only
        // ever stands where the host's own league stood, between two commands.
        const batch = (this.batch ??= { seq: message.seq, events: [] });
        if (message.seq !== batch.seq + batch.events.length) throw new Error('a piece is missing');
        for (const event of message.events) batch.events.push(event);
        if (!message.last) return;
        this.batch = null;
        const { requestId } = message;
        // The mirror's own queue keeps the batches in order. A command's answer waits for its
        // events to be applied, as a local one's does: screens refetch straight away.
        void this.mirror.applyRemote(batch.events, batch.seq).then(
          () => {
            if (requestId !== undefined) this.answer(requestId, { ok: true, events: batch.events });
          },
          (err: Error) => this.stop(err.message),
        );
        return;
      }
      case 'rejected':
        return this.answer(message.requestId, { ok: false, error: message.error });
      case 'bye':
        return this.stop(message.reason);
      default:
      // The peer list and the heartbeat: good messages nothing reads yet.
    }
  }
}
