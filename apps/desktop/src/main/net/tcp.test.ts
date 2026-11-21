import { connect, type Socket } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { WIRE } from '@gm/shared';
import { connectTcp, listenTcp } from './tcp';
import type { Connection } from './transport';

const LOCAL = '127.0.0.1';
const undo: (() => void)[] = [];
afterEach(() => {
  for (const close of undo.splice(0)) close();
});

/** A host on the loopback, and each connection it was handed with what came in on it. */
async function listening() {
  const host = await listenTcp(LOCAL);
  undo.push(() => host.close());
  const taken: { connection: Connection; packets: Buffer[]; closed: boolean }[] = [];
  host.listen((connection) => {
    const end = { connection, packets: [] as Buffer[], closed: false };
    connection.onPacket = (packet) => end.packets.push(Buffer.from(packet));
    connection.onClose = () => {
      end.closed = true;
    };
    taken.push(end);
    undo.push(() => connection.close());
  });
  /** The host's end of each connection made, in turn. */
  let handed = 0;
  const next = async () => {
    const at = handed++;
    await vi.waitFor(() => expect(taken.length).toBeGreaterThan(at));
    return taken[at]!;
  };
  return { host, taken, next };
}

/** A socket held by hand: the bytes a stranger would send. */
function raw(port: number) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = connect({ host: LOCAL, port }, () => resolve(socket));
    socket.once('error', reject);
    socket.on('error', () => undefined);
    socket.setNoDelay(true);
    undo.push(() => socket.destroy());
  });
}
const framed = (body: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, body]);
};
const closed = (socket: Socket) => new Promise<void>((done) => socket.once('close', () => done()));
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

it('hands over whole packets, however the bytes arrive', async () => {
  const { host, next } = await listening();
  const socket = await raw(host.port);
  const end = await next();
  const packets = [Buffer.from('the first packet'), Buffer.from('second'), Buffer.alloc(0)];
  const bytes = Buffer.concat(packets.map(framed));
  // A length cut in two, then a body cut in two: nothing is whole yet.
  socket.write(bytes.subarray(0, 2));
  await pause(20);
  socket.write(bytes.subarray(2, 11));
  await pause(20);
  expect(end.packets).toEqual([]);
  // The rest of the first packet with two more behind it, in one read.
  socket.write(bytes.subarray(11));
  await vi.waitFor(() => expect(end.packets).toEqual(packets));
  expect(end.closed).toBe(false);
});

it('closes on a length over the limit, before any of the body', async () => {
  const { host, next } = await listening();
  const socket = await raw(host.port);
  const end = await next();
  // The limit itself passes.
  socket.write(framed(Buffer.alloc(WIRE.packetBytes, 7)));
  await vi.waitFor(() => expect(end.packets).toHaveLength(1));
  expect(end.packets[0]!.length).toBe(WIRE.packetBytes);
  const over = Buffer.alloc(4);
  over.writeUInt32BE(WIRE.packetBytes + 1);
  socket.write(over);
  await closed(socket);
  expect(end.closed).toBe(true);
  expect(end.packets).toHaveLength(1);
});

it('counts what a slow peer has not taken', async () => {
  const { host, next } = await listening();
  const socket = await raw(host.port);
  socket.pause();
  const { connection } = await next();
  expect(connection.unsent).toBe(0);
  // 32 MB toward a peer who reads nothing: more than the sockets between them hold.
  for (let i = 0; i < 32; i++) connection.send(Buffer.alloc(WIRE.packetBytes));
  await pause(100);
  expect(connection.unsent).toBeGreaterThan(WIRE.packetBytes);
  socket.resume();
  await vi.waitFor(() => expect(connection.unsent).toBe(0), { timeout: 20_000 });
}, 30_000);

it('takes a full house and the strangers at its door, and nobody past them', async () => {
  const { host, taken } = await listening();
  const room = WIRE.guests + WIRE.strangers;
  for (let i = 0; i < room; i++) await raw(host.port);
  await vi.waitFor(() => expect(taken).toHaveLength(room));
  const extra = await raw(host.port);
  await closed(extra);
  expect(taken).toHaveLength(room);
  expect(taken.some((end) => end.closed)).toBe(false);
});

it('a close sends what was sent first and hands nothing over afterwards', async () => {
  const { host, next } = await listening();
  const guest = await connectTcp(LOCAL, host.port).connect();
  const got: string[] = [];
  let over = false;
  guest.onPacket = (packet) => got.push(Buffer.from(packet).toString());
  guest.onClose = () => {
    over = true;
  };
  const end = await next();
  expect(end.connection.peerKey).toBe(LOCAL);
  guest.send(Buffer.from('heard'));
  await vi.waitFor(() => expect(end.packets.map(String)).toEqual(['heard']));

  // The host's last word and its close, while the guest is still talking.
  end.connection.send(Buffer.from('bye'));
  end.connection.close();
  guest.send(Buffer.from('too late'));
  await vi.waitFor(() => expect(over).toBe(true));
  expect(got).toEqual(['bye']);
  expect(end.closed).toBe(true);
  expect(end.packets.map(String)).toEqual(['heard']);
  guest.send(Buffer.from('into the void')); // a closed connection takes a packet and does nothing

  // The host stops listening: there is nobody at that port.
  host.close();
  await expect(connectTcp(LOCAL, host.port).connect()).rejects.toThrow();
});
