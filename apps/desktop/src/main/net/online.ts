import {
  ID_MAX,
  isSafeText,
  type CommandResult,
  type GmApi,
  type SessionResult,
  type SessionStatus,
} from '@gm/shared';
import { LeagueService } from '../league';
import { GuestSession } from './guest';
import { HostSession } from './host';
import { connectTcp, lanAddresses, listenTcp } from './tcp';

type In<K extends keyof GmApi['session']> = Parameters<GmApi['session'][K]>[0];

/** A name for the lobby as the wire takes it: 32 characters, and `GM` for one it would refuse. */
function named(text: string) {
  const name = text.trim().slice(0, 32);
  return name && isSafeText(name) ? name : 'GM';
}

/**
 * This machine online: its own league, and at most one hosted league it hosts or is a guest in.
 * The window's queries read `league`, which is the host's mirror while this machine is a guest,
 * and its commands go through `dispatch`. A session method answers with a result, never a throw:
 * what went wrong (the host's refusal, a dead line, a wrong role) is text for the screen.
 */
export class Online {
  private hosting: { session: HostSession; port: number } | null = null;
  private guesting: { session: GuestSession; mirror: LeagueService } | null = null;
  /** A session is being opened: nothing else may start meanwhile. */
  private opening = false;
  /**
   * Why the last session ended by itself, until the next one: the league this machine was a guest
   * in is over, or the one it hosted closed on an error.
   */
  private ended?: string;

  /**
   * `changed`: main's push to the windows, for what they did not ask for. `bind`: the interface a
   * hosted league listens on, every one by default (the tests keep to the loopback).
   */
  constructor(
    private readonly own: LeagueService,
    private readonly appVersion: string,
    private readonly changed: () => void,
    private readonly bind?: string,
  ) {}

  /** The session this machine hosts, unless it closed itself (a batch it could not send). */
  private get hosted() {
    if (this.hosting?.session.closed) {
      this.hosting = null;
      this.ended = 'error';
    }
    return this.hosting;
  }

  /** The league the window reads: this machine's own, or the host's while it is a guest. */
  get league() {
    return this.guesting?.mirror ?? this.own;
  }

  /** This machine's own league, for what only happens outside a session: a new league, a roster load. */
  alone() {
    if (this.opening || this.hosted || this.guesting)
      throw new Error('Not while an online session is open.');
    return this.own;
  }

  private get asHost() {
    const session = this.hosted?.session;
    if (!session) throw new Error('Only the host of an online league does that.');
    return session;
  }

  private get asGuest() {
    const session = this.guesting?.session;
    if (!session) throw new Error('Only a guest of an online league does that.');
    return session;
  }

  /** A session method's answer: done, or why not, as text. */
  private async answer(job: () => unknown): Promise<SessionResult> {
    try {
      await job();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private open(job: () => Promise<void>) {
    return this.answer(async () => {
      this.alone();
      this.opening = true;
      try {
        await job();
        delete this.ended;
      } finally {
        this.opening = false;
      }
    });
  }

  /** Opens this machine's league to guests, on a port the OS picks, behind a join code. */
  host(input: In<'host'>) {
    return this.open(async () => {
      const transport = await listenTcp(this.bind);
      try {
        const session = await HostSession.start(this.own, transport, {
          appVersion: this.appVersion,
          joinCode: true,
          name: named(input.name),
          onChange: this.changed,
        });
        this.hosting = { session, port: transport.port };
      } catch (err) {
        transport.close();
        throw err;
      }
    });
  }

  /**
   * Joins the league hosted at an address. From then on `league` is its mirror, and this
   * machine's own save is left closed to the window until the session is over.
   */
  join(input: In<'join'>) {
    return this.open(async () => {
      const joinCode = input.joinCode.trim().toUpperCase().slice(0, ID_MAX);
      const mirror = new LeagueService(':memory:');
      try {
        const transport = connectTcp(input.address.trim(), input.port);
        const session = await GuestSession.join(mirror, transport, {
          appVersion: this.appVersion,
          name: named(input.name),
          ...(joinCode && { joinCode }),
          // Not before the window reads the mirror: until then nothing it shows has changed.
          onChange: () => {
            if (this.guesting) this.changed();
          },
        });
        this.guesting = { session, mirror };
        // It ends by itself when the host closes, kicks this guest, or stays out of reach.
        void session.ended.then((reason) => {
          if (this.guesting?.session !== session) return;
          this.guesting = null;
          this.ended = reason;
          mirror.dispose();
          this.changed();
        });
      } catch (err) {
        mirror.dispose();
        throw err;
      }
    });
  }

  /** The host ends the session for everyone; a guest goes back to his own league. */
  leave() {
    return this.answer(() => {
      const hosting = this.hosted;
      const { guesting } = this;
      if (!hosting && !guesting) throw new Error('No online session is open.');
      this.hosting = null;
      this.guesting = null;
      hosting?.session.close();
      guesting?.session.leave();
      guesting?.mirror.dispose();
    });
  }

  requestSeat(input: In<'requestSeat'>) {
    return this.answer(() => this.asGuest.requestSeat(input.teamId));
  }

  seat(input: In<'seat'>) {
    return this.answer(() => this.asHost.seat(input.key, input.teamId));
  }

  ready(input: In<'ready'>) {
    return this.answer(() => (this.guesting ? this.asGuest : this.asHost).ready(input.on));
  }

  grantAdvance(input: In<'grantAdvance'>) {
    return this.answer(() => this.asHost.grant(input.key, input.on));
  }

  kick(input: In<'kick'>) {
    return this.answer(() => this.asHost.kick(input.key));
  }

  status(): SessionStatus {
    const hosting = this.hosted;
    if (hosting) {
      const { session, port } = hosting;
      const direct = { addresses: lanAddresses(), port, joinCode: session.joinCode ?? '' };
      return { role: 'host', you: 0, peers: session.peers(), direct };
    }
    if (this.guesting) return { role: 'guest', ...this.guesting.session.status() };
    return { role: 'none', ...(this.ended !== undefined && { ended: this.ended }) };
  }

  /**
   * The window's command. The host's goes through his session (which keeps "can be fired" off and
   * clears Ready when the clock moves); a guest's goes to the host through his mirror, and "the
   * line is down" comes back as a refusal the screen can show, like any other.
   */
  dispatch(input: unknown): Promise<CommandResult> {
    const hosting = this.hosted;
    if (hosting) return hosting.session.dispatch(input);
    if (!this.guesting) return this.own.dispatch(input);
    return this.guesting.mirror.dispatch(input).catch((err: Error): CommandResult => ({
      ok: false,
      error: { code: 'invalid', message: err.message },
    }));
  }

  dispose() {
    this.hosting?.session.close();
    this.guesting?.session.leave();
    this.guesting?.mirror.dispose();
    this.own.dispose();
  }
}
