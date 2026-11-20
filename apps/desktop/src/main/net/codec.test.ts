import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { WIRE, type GuestMessage, type HostMessage } from '@gm/shared';
import { decode, encode } from './codec';

const packet = (json: string) => deflateSync(json);

describe('the codec', () => {
  it('carries a message each way', () => {
    const command: GuestMessage = {
      kind: 'command',
      requestId: 7,
      command: { kind: 'sim.advance', days: 1 },
    };
    expect(decode('guest', encode(command))).toEqual(command);
    const rows: HostMessage = { kind: 'snapshot.rows', table: 'meta', rows: [['season', '2027']] };
    expect(decode('host', encode(rows))).toEqual(rows);
  });

  it('refuses a message from the wrong side', () => {
    expect(() => decode('guest', encode({ kind: 'ping' }))).toThrow('bad message');
    expect(() => decode('host', encode({ kind: 'pong' }))).toThrow('bad message');
  });

  it('refuses a packet over the limit before it reads it', () => {
    expect(() => decode('host', Buffer.alloc(WIRE.packetBytes + 1))).toThrow('packet too big');
    // The sender's side of the same limit: random bytes do not deflate.
    const noise = randomBytes(1_500_000).toString('base64');
    expect(() => encode({ kind: 'snapshot.rows', table: 'meta', rows: [[noise]] })).toThrow(
      'message too big',
    );
  });

  it('refuses a zip bomb: a small packet that unpacks past the limit', () => {
    const blank = (bytes: number) => packet(`{"kind":"pong"${' '.repeat(bytes)}}`);
    expect(blank(100).length).toBeLessThan(100);
    expect(decode('guest', blank(100))).toEqual({ kind: 'pong' });
    const toGuestLimit = blank(WIRE.messageBytes.guest);
    expect(toGuestLimit.length).toBeLessThan(1000);
    expect(() => decode('guest', toGuestLimit)).toThrow(RangeError);
    const toHostLimit = packet(`{"kind":"ping"${' '.repeat(WIRE.messageBytes.host)}}`);
    expect(toHostLimit.length).toBeLessThan(WIRE.packetBytes);
    expect(() => decode('host', toHostLimit)).toThrow(RangeError);
  });

  it('refuses bytes that are not a deflated JSON message', () => {
    expect(() => decode('guest', Buffer.from('{"kind":"pong"}'))).toThrow();
    expect(() => decode('guest', packet('{"kind":"pong"'))).toThrow(SyntaxError);
    expect(() => decode('guest', packet('{"kind":"nope"}'))).toThrow('bad message');
    expect(() => decode('guest', packet('{"kind":"pong","actor":"local"}'))).toThrow('bad message');
    // JSON has no Infinity, but a number too large for a double parses as one.
    expect(() => decode('host', packet('{"kind":"snapshot.end","seq":1e999,"counts":{}}'))).toThrow(
      'bad message',
    );
    const proto = '{"kind":"snapshot.rows","table":"meta","rows":[["k","{\\"__proto__\\":1}"]]}';
    expect(() => decode('host', packet(proto))).toThrow('bad message');
  });
});
