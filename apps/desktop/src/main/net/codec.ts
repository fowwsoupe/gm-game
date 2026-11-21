import { deflateSync, inflateSync } from 'node:zlib';
import { parseMessage, WIRE, type WireMessages } from '@gm/shared';

/**
 * A hosted league's messages as packets: one message is one packet on every transport, JSON
 * deflated. `unpack` is the boundary for everything that arrives: the packet's size first, then a
 * bounded inflate (a small packet cannot unpack into gigabytes), then the message's schema. It
 * throws on anything but a good message, and whoever reads the connection closes it.
 *
 * ponytail: zlib runs here on the main thread, tens of milliseconds for a batch of several
 * megabytes. Its async API is the upgrade if a long sim's broadcast makes the host's window stutter.
 */
export function encode(message: WireMessages[keyof WireMessages]): Buffer {
  const packet = deflateSync(JSON.stringify(message));
  // The sender cuts a long batch into several messages: one that still outgrows a packet is a bug.
  if (packet.length > WIRE.packetBytes) throw new Error(`message too big: ${packet.length} bytes`);
  return packet;
}

/**
 * The message in a packet the `from` side sent, and the bytes it inflated to (a guest counts them
 * against its totals). `limit`: the most it may inflate to, that side's message limit by default.
 */
export function unpack<S extends keyof WireMessages>(
  from: S,
  packet: Uint8Array,
  limit: number = WIRE.messageBytes[from],
): { message: WireMessages[S]; bytes: number } {
  if (packet.length > WIRE.packetBytes) throw new Error(`packet too big: ${packet.length} bytes`);
  const json = inflateSync(packet, { maxOutputLength: limit });
  return { message: parseMessage(from, JSON.parse(json.toString())), bytes: json.length };
}

/** The message alone. */
export function decode<S extends keyof WireMessages>(
  from: S,
  packet: Uint8Array,
  limit?: number,
): WireMessages[S] {
  return unpack(from, packet, limit).message;
}
