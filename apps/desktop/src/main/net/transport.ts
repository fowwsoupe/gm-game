/**
 * What a hosted league asks of a network: packets between the host and each guest, whole and in
 * order. The sessions (`host.ts`, `guest.ts`) know nothing else about it, so the same session code
 * runs over the loopback below, a direct connection and Steam.
 */
export interface Connection {
  /**
   * Who is at the other end, as far as the transport can vouch for it: an address on a direct
   * connection (two games on one machine share theirs), a SteamID on Steam. Never taken from a
   * message. The host counts wrong join codes by it, and on Steam it is who the guest is: what
   * his place and his seat go by.
   */
  readonly peerKey: string;
  /**
   * One packet. It arrives whole and after every packet sent before it, or the connection closes.
   * On a closed connection it does nothing.
   */
  send(packet: Uint8Array): void;
  /**
   * The bytes handed to `send` that have not left this machine yet: how the host sees a guest who
   * takes them in slower than they come. Zero where the transport cannot tell.
   */
  readonly unsent: number;
  /**
   * Ends the connection. Packets already sent still reach the other end; none is handed to this
   * end after the call, so a session that closes a connection has heard the last of it. (One
   * exception, on Steam: what a guest sent in the same turn as his own close may not arrive. See
   * `joinSteam`.)
   */
  close(): void;
  /** Set by the session as soon as it is handed the connection: nothing arrives before that. */
  onPacket: (packet: Uint8Array) => void;
  /** Called once when the connection is gone, whichever end closed it. */
  onClose: () => void;
}

export interface HostTransport {
  /** Starts taking guests: each connection is handed over before its first packet. */
  listen(onConnection: (connection: Connection) => void): void;
  /** Stops taking new guests. The open connections are the session's to close. */
  close(): void;
}

export interface GuestTransport {
  connect(): Promise<Connection>;
}

/** One end of a loopback connection. Packets are delivered later and as copies, as a socket's are. */
class LoopbackEnd implements Connection {
  other!: LoopbackEnd;
  unsent = 0;
  private open = true;
  onPacket: (packet: Uint8Array) => void = () => undefined;
  onClose: () => void = () => undefined;

  constructor(
    readonly peerKey: string,
    private readonly lost: (packet: Uint8Array) => boolean,
  ) {}

  send(packet: Uint8Array) {
    if (!this.open || this.lost(packet)) return;
    const copy = Buffer.from(packet);
    this.unsent += copy.length;
    queueMicrotask(() => {
      this.unsent -= copy.length;
      if (this.other.open) this.other.onPacket(copy);
    });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    queueMicrotask(() => {
      this.onClose();
      this.other.close();
    });
  }
}

export interface Loopback {
  host: HostTransport;
  guest: GuestTransport;
  /**
   * For a test of drops: while this is set, a packet it says yes to is lost on its way `to` that
   * side, and neither end is told.
   */
  lose?: (packet: Uint8Array, to: 'host' | 'guest') => boolean;
}

/**
 * The transport of the tests: a host and its guests in one process. It carries bytes, not objects,
 * so a session test goes through the same deflate, size check, inflate and schema as a real
 * connection, and it loses packets on demand, which a real one only does by closing.
 */
export function loopback(): Loopback {
  let listener: ((connection: Connection) => void) | null = null;
  let made = 0;
  const net: Loopback = {
    host: {
      listen: (onConnection) => {
        listener = onConnection;
      },
      close: () => {
        listener = null;
      },
    },
    guest: {
      connect: () => {
        if (!listener) return Promise.reject(new Error('Nobody is hosting.'));
        const atHost = new LoopbackEnd(`loopback-${++made}`, (p) => !!net.lose?.(p, 'guest'));
        const atGuest = new LoopbackEnd('host', (p) => !!net.lose?.(p, 'host'));
        atHost.other = atGuest;
        atGuest.other = atHost;
        listener(atHost);
        return Promise.resolve(atGuest);
      },
    },
  };
  return net;
}
