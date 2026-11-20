/**
 * What a hosted league asks of a network: packets between the host and each guest, whole and in
 * order. The sessions (`host.ts`, `guest.ts`) know nothing else about it, so the same session code
 * runs over the loopback below, a direct connection and Steam.
 */
export interface Connection {
  /**
   * Who is at the other end, as the transport vouches for it, and unlike any other open
   * connection's. Never taken from a message.
   */
  readonly peerKey: string;
  /**
   * One packet. It arrives whole and after every packet sent before it, or the connection closes.
   * On a closed connection it does nothing.
   */
  send(packet: Uint8Array): void;
  /**
   * Ends the connection. Packets already sent still reach the other end; none is handed to this
   * end after the call, so a session that closes a connection has heard the last of it.
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
  private open = true;
  onPacket: (packet: Uint8Array) => void = () => undefined;
  onClose: () => void = () => undefined;

  constructor(readonly peerKey: string) {}

  send(packet: Uint8Array) {
    if (!this.open) return;
    const copy = Buffer.from(packet);
    queueMicrotask(() => {
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

/**
 * The transport of the tests: a host and its guests in one process. It carries bytes, not objects,
 * so a session test goes through the same deflate, size check, inflate and schema as a real
 * connection.
 */
export function loopback(): { host: HostTransport; guest: GuestTransport } {
  let listener: ((connection: Connection) => void) | null = null;
  let made = 0;
  return {
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
        const atHost = new LoopbackEnd(`loopback-${++made}`);
        const atGuest = new LoopbackEnd('host');
        atHost.other = atGuest;
        atGuest.other = atHost;
        listener(atHost);
        return Promise.resolve(atGuest);
      },
    },
  };
}
