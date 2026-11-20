import { describe, expect, it } from 'vitest';
import type { GuestMessage, HostMessage } from './wire';
import { isSafeJson, parseMessage } from './wire';

/** As it arrives: through JSON, never the sender's own object. */
const sent = (message: unknown): unknown => JSON.parse(JSON.stringify(message));
const refused = (from: 'guest' | 'host', message: unknown) => {
  try {
    parseMessage(from, sent(message));
    return false;
  } catch (err) {
    return (err as Error).message.startsWith('bad message');
  }
};

const event = {
  id: 'e2027-12-340',
  date: { season: 2027, day: 12 },
  kind: 'team.renamed',
  importance: 'notable',
  teamIds: ['t3'],
  teamId: 't3',
  city: 'Québec',
  name: 'Fleuves',
  abbreviation: 'QBF',
};
const events = { kind: 'events', seq: 340, events: [event], last: true };

const fromGuest: GuestMessage[] = [
  { kind: 'hello', protocol: 1, appVersion: '0.0.1', saveSchema: 23, name: 'Minh' },
  {
    kind: 'hello',
    protocol: 1,
    appVersion: '0.0.1',
    saveSchema: 23,
    name: 'Minh',
    joinCode: 'K7QX2M',
    resumeKey: 'r-1',
  },
  { kind: 'seat.request', teamId: 't3' as never },
  { kind: 'ready', on: true },
  { kind: 'command', requestId: 1, command: { kind: 'sim.advance', days: 1 } },
  { kind: 'resync', seq: 340 },
  { kind: 'resync' },
  { kind: 'pong' },
];
const fromHost: HostMessage[] = [
  { kind: 'welcome', sessionId: 's-1', rulesetId: 'nhl-2026', sport: 'nhl', resumeKey: 'r-1' },
  { kind: 'refused', reason: 'appVersion' },
  {
    kind: 'session',
    peers: [{ name: 'Minh', teamId: null, connected: true, ready: false, can: ['advance'] }],
  },
  { kind: 'snapshot.begin' },
  {
    kind: 'snapshot.rows',
    table: 'meta',
    rows: [
      ['season', '2027'],
      ['career', 'null'],
    ],
  },
  { kind: 'snapshot.end', seq: 340, counts: { meta: 2 } },
  events as HostMessage,
  { ...events, requestId: 1 } as HostMessage,
  { kind: 'rejected', requestId: 1, error: { code: 'not_allowed', message: 'not your team' } },
  { kind: 'ping' },
  { kind: 'bye', reason: 'kicked' },
];

describe('the wire messages', () => {
  it.each(fromGuest)('passes a guest $kind unchanged', (message) => {
    expect(parseMessage('guest', sent(message))).toEqual(message);
  });

  it.each(fromHost)('passes a host $kind unchanged', (message) => {
    expect(parseMessage('host', sent(message))).toEqual(message);
  });

  it('refuses an unknown kind, an extra key and a message from the other side', () => {
    expect(refused('guest', { kind: 'advance' })).toBe(true);
    expect(refused('guest', { kind: 'pong', extra: 1 })).toBe(true);
    expect(refused('guest', { kind: 'ping' })).toBe(true);
    expect(refused('host', { kind: 'pong' })).toBe(true);
    expect(refused('host', null)).toBe(true);
    expect(refused('host', [])).toBe(true);
  });

  it('refuses a command that says who sends it, and a malformed one', () => {
    const command = { kind: 'command', requestId: 1, command: { kind: 'sim.advance', days: 1 } };
    const actor = { id: 'local', controls: [] };
    expect(refused('guest', command)).toBe(false);
    expect(refused('guest', { ...command, actor })).toBe(true);
    expect(refused('guest', { ...command, command: { ...command.command, actor } })).toBe(true);
    expect(refused('guest', { ...command, command: { kind: 'sim.advance', days: -1 } })).toBe(true);
    expect(refused('guest', { ...command, requestId: 1.5 })).toBe(true);
  });

  it('refuses a name the game cannot use, wherever it stands', () => {
    const rows = (cell: unknown) => ({ kind: 'snapshot.rows', table: 'meta', rows: [[cell]] });
    const one = (e: unknown) => ({ ...events, events: [e] });
    for (const bad of ['__proto__', 'constructor', 'toString', 'x__proto__y']) {
      expect(refused('guest', { ...fromGuest[0]!, name: bad }), bad).toBe(true);
      expect(refused('guest', { kind: 'seat.request', teamId: bad }), bad).toBe(true);
      expect(refused('host', { kind: 'snapshot.rows', table: bad, rows: [] }), bad).toBe(true);
      const end = JSON.parse(`{"kind":"snapshot.end","seq":1,"counts":{"${bad}":1}}`) as unknown;
      expect(() => parseMessage('host', end), bad).toThrow('bad message');
      const extra = JSON.parse(`{"kind":"pong","${bad}":1}`) as unknown;
      expect(() => parseMessage('guest', extra), `extra ${bad}`).toThrow('bad message');
      const inCommand = JSON.parse(
        `{"kind":"command","requestId":1,"command":{"kind":"sim.advance","days":1,"${bad}":1}}`,
      ) as unknown;
      expect(() => parseMessage('guest', inCommand), `command ${bad}`).toThrow('bad message');
      // In an event: its header, a value of its payload, a key of its payload.
      expect(refused('host', one({ ...event, teamIds: [bad] })), bad).toBe(true);
      expect(refused('host', one({ ...event, city: bad })), bad).toBe(true);
      const keyed = JSON.parse(`{"id":"e1","deep":[{"${bad}":1}]}`) as object;
      expect(refused('host', one({ ...event, ...keyed })), bad).toBe(true);
      // In a snapshot: a plain cell, and inside a cell that holds JSON.
      expect(refused('host', rows(bad)), bad).toBe(true);
      expect(refused('host', rows(`{"${bad}":1}`)), bad).toBe(true);
      expect(refused('host', rows(`[["${bad}"]]`)), bad).toBe(true);
      expect(refused('host', rows(`"${bad}"`)), bad).toBe(true);
      expect(refused('host', rows(` \n\t{"${bad}":1}`)), bad).toBe(true);
    }
  });

  it('checks an event header by field', () => {
    const one = (e: unknown) => ({ ...events, events: [e] });
    expect(refused('host', one(event))).toBe(false);
    expect(refused('host', one({ ...event, playerIds: ['p1'] }))).toBe(false);
    expect(refused('host', one({ ...event, id: undefined }))).toBe(true);
    expect(refused('host', one({ ...event, id: { a: 1 } }))).toBe(true);
    expect(refused('host', one({ ...event, date: { season: 2027 } }))).toBe(true);
    expect(refused('host', one({ ...event, date: { season: 2027, day: 1.5 } }))).toBe(true);
    expect(refused('host', one({ ...event, importance: 'huge' }))).toBe(true);
    expect(refused('host', one({ ...event, teamIds: 't3' }))).toBe(true);
    expect(refused('host', one({ ...event, playerIds: [1] }))).toBe(true);
    expect(refused('host', one('team.renamed'))).toBe(true);
  });

  it('takes a snapshot cell as text, a finite number or null, and nothing else', () => {
    const rows = (...cells: unknown[]) => ({ kind: 'snapshot.rows', table: 'meta', rows: [cells] });
    expect(refused('host', rows('Québec', 2027, 1.4, null, '', '{"a":[1,"b"]}'))).toBe(false);
    // Text that only looks like JSON is plain text.
    expect(refused('host', rows('[Wolves', '{', '"'))).toBe(false);
    expect(refused('host', rows(true))).toBe(true);
    expect(refused('host', rows({ a: 1 }))).toBe(true);
    expect(refused('host', rows(['a']))).toBe(true);
    expect(refused('host', rows('x'.repeat(10_001)))).toBe(true);
    expect(refused('host', { kind: 'snapshot.rows', table: 'meta', rows: ['season'] })).toBe(true);
    // JSON has no Infinity, but a number too large for a double parses as one.
    const huge = JSON.parse('{"kind":"snapshot.rows","table":"meta","rows":[[1e999]]}') as unknown;
    expect(() => parseMessage('host', huge)).toThrow('bad message');
    expect(refused('host', rows('{"a":1e999}'))).toBe(true);
  });

  it('names the first fault, cut short', () => {
    expect(() => parseMessage('guest', { kind: 'ready', on: 'yes' })).toThrow(/^bad message: on: /);
    let message = '';
    try {
      parseMessage('guest', { kind: 'x'.repeat(1000) });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/^bad message: /);
    expect(message.length).toBeLessThanOrEqual(200);
  });
});

describe('the generic guard', () => {
  it('passes plain JSON', () => {
    expect(isSafeJson({ a: [1, 'b', null, true, { c: -0.5 }], d: {} })).toBe(true);
  });

  it('refuses what JSON cannot hold', () => {
    for (const bad of [undefined, NaN, Infinity, 1n, () => 1, Symbol('s')]) {
      expect(isSafeJson(bad)).toBe(false);
      expect(isSafeJson({ a: [bad] })).toBe(false);
    }
    expect(isSafeJson(new Date(0))).toBe(false);
    expect(isSafeJson(new Map())).toBe(false);
    expect(isSafeJson(Object.create(null))).toBe(false);
  });

  it('bounds depth and string length', () => {
    const nested = (depth: number) => JSON.parse('['.repeat(depth) + ']'.repeat(depth)) as unknown;
    expect(isSafeJson(nested(32))).toBe(true);
    expect(isSafeJson(nested(33))).toBe(false);
    expect(isSafeJson(nested(5000))).toBe(false);
    expect(isSafeJson('x'.repeat(10_000))).toBe(true);
    expect(isSafeJson('x'.repeat(10_001))).toBe(false);
  });
});
