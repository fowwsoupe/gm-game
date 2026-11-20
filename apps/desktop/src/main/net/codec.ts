import { deflateSync, inflateSync } from 'node:zlib';
import { parseMessage, WIRE, type WireMessages } from '@gm/shared';

/**
 * A hosted league's messages as packets: one message is one packet on every transport, JSON
 * deflated. `decode` is the boundary for everything that arrives: the packet's size first, then a
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

/** The message in a packet the `from` side sent. */
export function decode<S extends keyof WireMessages>(from: S, packet: Uint8Array): WireMessages[S] {
  if (packet.length > WIRE.packetBytes) throw new Error(`packet too big: ${packet.length} bytes`);
  const json = inflateSync(packet, { maxOutputLength: WIRE.messageBytes[from] }).toString();
  return parseMessage(from, JSON.parse(json));
}
