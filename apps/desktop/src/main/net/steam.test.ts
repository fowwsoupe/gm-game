import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WIRE } from '@gm/shared';
import { fakeSteam } from './fakeSteam';
import { hostSteam, joinSteam } from './steam';
import type { Connection } from './transport';

// The transport reads Steam's packets on a timer and counts the time between a SteamID's
// connections: both clocks are the test's.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});
/** Longer than the transport waits between two reads. */
const tick = () => vi.advanceTimersByTimeAsync(50);
/** Long enough for a SteamID's next connection to count as one. */
const later = () => vi.advanceTimersByTimeAsync(WIRE.reconnectMs);

/** An end of a connection, with what came in on it. */
function taking(connection: Connection) {
  const end = { connection, packets: [] as Buffer[], closed: false };
  connection.onPacket = (packet) => end.packets.push(Buffer.from(packet));
  connection.onClose = () => {
    end.closed = true;
  };
  return end;
}
const texts = (end: { packets: Buffer[] }) => end.packets.map(String);

/** A league hosted on the fake Steam by Minh, with Guy and Ann on Steam too. */
async function hosting() {
  const net = fakeSteam();
  const minh = net.player(76561198000000001n, 'Minh');
  const guy = net.player(76561198000000002n, 'Guy');
  const ann = net.player(76561198000000003n, 'Ann');
  const host = await hostSteam(minh.steam);
  const taken: ReturnType<typeof taking>[] = [];
  host.listen((connection) => taken.push(taking(connection)));
  const room = [...net.lobbies.values()][0]!;
  return { net, minh, guy, ann, host, taken, room };
}

const DATA = 0;
const CLOSE = 1;
const RELIABLE = 2;
/** A frame as the transport makes them, by hand: the connection's number, what it is, the packet. */
function frame(id: number, kind: number, text = '') {
  const head = Buffer.alloc(5);
  head.writeUInt32BE(id);
  head[4] = kind;
  return Buffer.concat([head, Buffer.from(text)]);
}

it('a friends-only lobby of 32, and packets whole and in order both ways', async () => {
  const { minh, guy, host, taken, room } = await hosting();
  expect(room).toMatchObject({ type: 1, max: 32, owner: minh.id, members: [minh.id] });
  host.invite();
  expect(room.invites).toBe(1);

  const guest = taking(await joinSteam(guy.steam, room.id).connect());
  expect(room.members).toEqual([minh.id, guy.id]);
  // Who is at the other end is Steam's word, on both sides.
  expect(guest.connection.peerKey).toBe(String(minh.id));
  const packets = [
    Buffer.from('the first packet'),
    Buffer.alloc(0),
    Buffer.alloc(WIRE.packetBytes, 7), // the largest the wire sends, under Steam's megabyte
    Buffer.from('the last'),
  ];
  const same = (got: Buffer[]) => got.map((packet, i) => packet.equals(packets[i]!));
  for (const packet of packets) guest.connection.send(packet);
  await tick();
  expect(taken).toHaveLength(1);
  const end = taken[0]!;
  expect(end.connection.peerKey).toBe(String(guy.id));
  expect(same(end.packets)).toEqual([true, true, true, true]);
  for (const packet of packets) end.connection.send(packet);
  await tick();
  expect(same(guest.packets)).toEqual([true, true, true, true]);
  expect(end.connection.unsent).toBe(0); // Steam does not say what it still holds
  expect(end.closed || guest.closed).toBe(false);
});

it('only a member of the lobby is heard, from when he enters to when he leaves', async () => {
  const { minh, ann, taken, room } = await hosting();
  const send = (packet: Buffer) => ann.steam.networking.sendP2PPacket(minh.id, RELIABLE, packet);
  // Not in the lobby: her session is not accepted, and her packet is never read.
  send(frame(1, DATA, 'early'));
  await tick();
  expect(taken).toHaveLength(0);
  // In: her session is accepted, and what she sent is a connection of hers.
  const seat = await ann.steam.matchmaking.joinLobby(room.id);
  await tick();
  expect(taken).toHaveLength(1);
  expect(taken[0]!.connection.peerKey).toBe(String(ann.id));
  expect(texts(taken[0]!)).toEqual(['early']);
  // What is not a frame is dropped, an empty packet too, and holds up nothing behind it.
  send(Buffer.alloc(0));
  send(Buffer.from('abc'));
  send(frame(1, DATA, 'next'));
  await tick();
  expect(texts(taken[0]!)).toEqual(['early', 'next']);
  expect(taken[0]!.closed).toBe(false);
  // Out: her connection is closed. Steam still delivers what she sends (0.4.0 closes no
  // session), and it is read and dropped.
  seat.leave();
  await tick();
  expect(taken[0]!.closed).toBe(true);
  await later();
  send(frame(2, DATA, 'still here'));
  await tick();
  expect(taken).toHaveLength(1);
  expect(() => minh.steam.networking.readP2PPacket(0)).toThrow(); // nothing left waiting
});

it('a close reaches the other end, and nothing is handed over after it', async () => {
  const { minh, guy, host, taken, room } = await hosting();
  let guest = taking(await joinSteam(guy.steam, room.id).connect());
  guest.connection.send(Buffer.from('heard'));
  await tick();
  const end = taken[0]!;
  // The host's last word and its close, while the guest is still talking.
  end.connection.send(Buffer.from('bye'));
  end.connection.close();
  guest.connection.send(Buffer.from('too late'));
  await tick();
  expect(texts(guest)).toEqual(['bye']);
  expect(guest.closed).toBe(true);
  expect(end.closed).toBe(true);
  expect(texts(end)).toEqual(['heard']);
  // A closed connection takes a packet and does nothing, and its guest is out of the lobby.
  guest.connection.send(Buffer.from('into the void'));
  expect(room.members).toEqual([minh.id]);

  // The guest's close reaches the host too. He is out of the lobby in the same turn, so a packet
  // he sent just before it goes with him: a guest's session sends none.
  await later();
  guest = taking(await joinSteam(guy.steam, room.id).connect());
  guest.connection.send(Buffer.from('back'));
  await tick();
  const again = taken[1]!;
  guest.connection.send(Buffer.from('my last word'));
  guest.connection.close();
  again.connection.send(Buffer.from('too late'));
  await tick();
  expect(texts(again)).toEqual(['back']);
  expect(again.closed).toBe(true);
  expect(guest.packets).toEqual([]);
  expect(guest.closed).toBe(true);

  // The host stops: its lobby is left, and there is nothing to join.
  host.close();
  expect(room.members).toEqual([]);
  await expect(joinSteam(guy.steam, room.id).connect()).rejects.toThrow();
});

it("a member's new connection number is a new connection, once in a while", async () => {
  const { minh, ann, taken, room } = await hosting();
  await ann.steam.matchmaking.joinLobby(room.id);
  const send = (id: number, kind: number, text = '') =>
    ann.steam.networking.sendP2PPacket(minh.id, RELIABLE, frame(id, kind, text));
  send(7, DATA, 'one');
  await tick();
  expect(taken).toHaveLength(1);
  // Another number straight away is dropped, and the connection she has stays.
  send(8, DATA, 'two');
  await tick();
  expect(taken).toHaveLength(1);
  expect(taken[0]!.closed).toBe(false);
  // Later it is her new connection, and the old one is over.
  await later();
  send(8, DATA, 'two');
  send(7, DATA, 'on the old one');
  await tick();
  expect(taken).toHaveLength(2);
  expect(taken[0]!.closed).toBe(true);
  expect(texts(taken[0]!)).toEqual(['one']);
  expect(texts(taken[1]!)).toEqual(['two']);
  // A close opens nothing, and any frame that is not a packet ends the connection it names.
  await later();
  send(9, CLOSE);
  await tick();
  expect(taken).toHaveLength(2);
  expect(taken[1]!.closed).toBe(false);
  send(8, 77);
  send(8, DATA, 'after the end');
  await tick();
  expect(taken[1]!.closed).toBe(true);
  expect(texts(taken[1]!)).toEqual(['two']);
});

it('what Steam says is gone is closed: a lost line, a packet it refuses', async () => {
  const { net, minh, guy, taken, room } = await hosting();
  const first = taking(await joinSteam(guy.steam, room.id).connect());
  first.connection.send(Buffer.from('a'));
  await tick();
  // The line is lost: both ends close, and the guest is out of the lobby.
  net.cut(minh.id, guy.id);
  await tick();
  expect(first.closed).toBe(true);
  expect(taken[0]!.closed).toBe(true);
  expect(room.members).toEqual([minh.id]);

  // He comes back: each side has to accept the other again, and does.
  await later();
  const second = taking(await joinSteam(guy.steam, room.id).connect());
  second.connection.send(Buffer.from('b'));
  await tick();
  const end = taken[1]!;
  end.connection.send(Buffer.from('c'));
  await tick();
  expect(texts(end)).toEqual(['b']);
  expect(texts(second)).toEqual(['c']);

  // Steam refuses a packet (over its megabyte; nobody there): that end is closed.
  end.connection.send(Buffer.alloc(1024 * 1024));
  await tick();
  expect(end.closed).toBe(true);
  net.unreachable.add(minh.id);
  second.connection.send(Buffer.from('d'));
  await tick();
  expect(second.closed).toBe(true);
});

it('a guest follows the host he found, never the next owner of the lobby', async () => {
  const { minh, guy, ann, host, taken, room } = await hosting();
  const transport = joinSteam(guy.steam, room.id);
  const first = taking(await transport.connect());
  first.connection.send(Buffer.from('a'));
  await tick();
  await ann.steam.matchmaking.joinLobby(room.id);
  // The host stops, and Steam hands his lobby on: to the guest, then to Ann when he drops out.
  host.close();
  taken[0]!.connection.close();
  await tick();
  expect(first.closed).toBe(true);
  expect(room).toMatchObject({ owner: ann.id, members: [ann.id] });

  // His next connection is to the host he knew, who reads nothing any more.
  const second = taking(await transport.connect());
  expect(second.connection.peerKey).toBe(String(minh.id));
  second.connection.send(Buffer.from('anyone?'));
  const sent = minh.steam.networking.readP2PPacket(minh.steam.networking.isP2PPacketAvailable());
  expect(sent.steamId.steamId64).toBe(guy.id);
  expect(String(sent.data.subarray(5))).toBe('anyone?');
  // The lobby's owner answers on that connection's number: she is not the host, and is not heard.
  const id = sent.data.readUInt32BE(0);
  ann.steam.networking.sendP2PPacket(guy.id, RELIABLE, frame(id, DATA, 'I host now'));
  ann.steam.networking.sendP2PPacket(guy.id, RELIABLE, frame(id, CLOSE));
  await tick();
  expect(second.packets).toEqual([]);
  expect(second.closed).toBe(false);

  // A lobby whose owner is this player has no host to follow, and one that is gone has nothing.
  await expect(joinSteam(ann.steam, room.id).connect()).rejects.toThrow('Nobody is hosting.');
  await expect(joinSteam(ann.steam, 5n).connect()).rejects.toThrow();
});
