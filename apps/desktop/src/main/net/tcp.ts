import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import { WIRE } from '@gm/shared';
import type { Connection, GuestTransport, HostTransport } from './transport';

/** How long a closed socket may take to send what it still holds before it is cut. */
const LINGER_MS = 5_000;

/**
 * The direct connection: a TCP socket between two games, each packet behind its length (4 bytes,
 * big-endian). It is not encrypted and proves nothing about who is at the other end: LAN play and
 * testing only. What lets a guest in is the session's join code.
 */
function framed(socket: Socket): Connection {
  socket.setNoDelay(true);
  let open = true;
  /** Read and not handed over yet: the start of a packet whose end has not come. */
  let held: Buffer = Buffer.alloc(0);
  const gone = () => {
    if (!open) return;
    open = false;
    connection.onClose();
  };
  const connection: Connection = {
    // An address, which several connections can share (two games on one machine).
    peerKey: socket.remoteAddress ?? '',
    get unsent() {
      return socket.writableLength;
    },
    send(packet) {
      if (!open) return;
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(packet.length);
      socket.cork();
      socket.write(length);
      socket.write(packet);
      socket.uncork();
    },
    close() {
      if (!open) return;
      open = false;
      // What was sent still goes out and the other end closes in answer; one that does not, or
      // that takes nothing in, is cut.
      socket.end();
      const cut = setTimeout(() => socket.destroy(), LINGER_MS);
      socket.once('close', () => clearTimeout(cut));
      queueMicrotask(() => connection.onClose());
    },
    onPacket: () => undefined,
    onClose: () => undefined,
  };
  socket.on('data', (chunk: Buffer) => {
    if (!open) return; // read and let go: nothing is handed over after `close()`
    held = held.length ? Buffer.concat([held, chunk]) : chunk;
    while (open && held.length >= 4) {
      const length = held.readUInt32BE(0);
      if (length > WIRE.packetBytes) {
        // Closed on the length alone: the body is never read.
        socket.destroy();
        return gone();
      }
      if (held.length < 4 + length) break;
      const packet = held.subarray(4, 4 + length);
      held = held.subarray(4 + length);
      connection.onPacket(packet);
    }
  });
  socket.on('error', () => undefined); // 'close' follows, and is all a session needs to hear
  socket.on('close', gone);
  return connection;
}

/**
 * The host's side: a server on a port the OS picks, on every interface unless `bind` names one.
 * It holds a full house of guests and a few connections more (the ones that have not said `hello`
 * yet, which the session closes after `WIRE.helloMs`); one past that is not taken.
 */
export function listenTcp(bind?: string): Promise<HostTransport & { readonly port: number }> {
  return new Promise((resolve, reject) => {
    let listener: ((connection: Connection) => void) | null = null;
    const server = createServer((socket) => {
      if (listener) listener(framed(socket));
      else socket.destroy();
    });
    server.maxConnections = WIRE.guests + WIRE.strangers;
    server.on('error', reject); // after the start it only keeps a failed accept from being fatal
    server.listen(0, bind, () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        listen: (onConnection) => {
          listener = onConnection;
        },
        close: () => {
          listener = null;
          server.close();
        },
      }),
    );
  });
}

/** A guest's side: a socket to the host's address and port. */
export function connectTcp(address: string, port: number): GuestTransport {
  return {
    connect: () =>
      new Promise((resolve, reject) => {
        const socket = connect({ host: address, port });
        // An address that never answers would hold a join for minutes.
        const slow = setTimeout(() => socket.destroy(new Error('timed out')), WIRE.helloMs);
        socket.once('close', () => clearTimeout(slow));
        socket.once('error', reject);
        socket.once('connect', () => {
          clearTimeout(slow);
          socket.off('error', reject);
          resolve(framed(socket));
        });
      }),
  };
}

/** This machine's addresses on its networks: what the host reads out, with the port and the code. */
export const lanAddresses = () =>
  Object.values(networkInterfaces()).flatMap((addresses = []) =>
    addresses.filter((a) => a.family === 'IPv4' && !a.internal).map((a) => a.address),
  );
