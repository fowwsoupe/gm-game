import { z } from 'zod';
import { commandSchema, ID_MAX, isSafeText } from './command-schema';
import type { TeamId } from './domain';
import type { LeagueEvent } from './events';

/**
 * The messages of a hosted online league, as untrusted data. One message is one packet: JSON,
 * deflated (the codec is in the desktop app's main process). Nothing acts on a message before
 * `parseMessage` has passed it: an unknown kind, an extra key, a wrong type, a non-finite number
 * and an unsafe string are all refused.
 *
 * What a guest sends can reach the host's save, so it is checked field by field (a command through
 * `commandSchema`). What the host sends reaches a mirror the guest can throw away: the envelope
 * and each event's header are checked by field, the rest of each event and every snapshot cell by
 * the generic guard, `isSafeJson`.
 */
export const WIRE = {
  /** Goes up whenever a message changes shape; the handshake refuses another number. */
  protocol: 1,
  /** One packet, either way (a reliable Steam packet cannot be larger than 1 MB). */
  packetBytes: 1_000_000,
  /** One message after inflating, by who sent it. */
  messageBytes: { guest: 64 * 1024, host: 8 * 1024 * 1024 },
  /** Guests of one host: 32 humans with him. */
  guests: 31,
} as const;

const DEPTH_MAX = 32;
/**
 * The longest string inside a message. A season and a summer of real events and rows hold none
 * over 30 characters (`mirror.test.ts` in the desktop app plays them through this guard).
 */
const STRING_MAX = 10_000;

/**
 * The generic guard: plain JSON only, finite numbers, bounded depth and string length, and every
 * key and string under the string rule (`isSafeText`).
 */
export function isSafeJson(value: unknown, depth = DEPTH_MAX): boolean {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= STRING_MAX && isSafeText(value);
  if (typeof value !== 'object' || depth === 0) return false;
  if (Array.isArray(value)) return value.every((v) => isSafeJson(v, depth - 1));
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(([k, v]) => isSafeText(k) && isSafeJson(v, depth - 1));
}

/** One value of a save's row. */
export type Cell = string | number | null;
/** Rows of one table of a save, each with its cells in the table's column order. */
export interface TableRows {
  table: string;
  rows: Cell[][];
}

/**
 * A snapshot cell: null, a finite number or text. Most of a save's text is JSON (ratings, box
 * scores, an event's payload): text that parses as a JSON object, list or string goes through the
 * guard as that value, any other text as the string it is.
 */
function isSafeCell(cell: unknown): boolean {
  if (typeof cell !== 'string')
    return cell === null || (typeof cell === 'number' && Number.isFinite(cell));
  // Leading blanks count: `JSON.parse`, which reads the cell on the mirror, skips them too.
  if (/^\s*[{["]/.test(cell)) {
    try {
      return isSafeJson(JSON.parse(cell));
    } catch {
      // Not JSON after all (a name that starts with a bracket): plain text.
    }
  }
  return isSafeJson(cell);
}

const unsafe = 'a name the game cannot use';
const id = z.string().min(1).max(ID_MAX).refine(isSafeText, unsafe);
const teamId = id as unknown as z.ZodType<TeamId>;
/** A count of events or rows, a request id, a version number. */
const count = z.int().min(0);
/** A player's display name: text for the list, never used to decide anything. */
const name = z.string().min(1).max(32).refine(isSafeText, unsafe);

const eventHeader = z.looseObject({
  id,
  date: z.strictObject({ season: z.int(), day: z.int() }),
  kind: id,
  importance: z.enum(['minor', 'notable', 'major']),
  teamIds: z.array(id).max(1000),
  playerIds: z.array(id).max(1000).exactOptional(),
});
/** The header (what the save binds into columns) by field, the rest through the guard. */
const event = z.custom<LeagueEvent>(
  (e) => eventHeader.safeParse(e).success && isSafeJson(e),
  'not an event',
);
const rows = z.custom<Cell[][]>(
  (v) => Array.isArray(v) && v.every((row) => Array.isArray(row) && row.every(isSafeCell)),
  'not rows',
);

/** Rows per table. The guard goes first: `z.record` skips a `__proto__` key, it does not refuse it. */
const counts = z.custom<Record<string, number>>(isSafeJson, unsafe).pipe(z.record(id, count));

const kind = <K extends string>(k: K) => z.literal(k);

/** What a guest may send. It never names who is sending: the host knows that from the connection. */
export const guestMessageSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: kind('hello'),
    protocol: count,
    appVersion: id,
    saveSchema: count,
    name,
    /** The gate of a direct connection. */
    joinCode: id.exactOptional(),
    /** From an earlier `welcome` of the same session: gives a dropped guest his seat back. */
    resumeKey: id.exactOptional(),
  }),
  /** A wish: the host decides. */
  z.strictObject({ kind: kind('seat.request'), teamId }),
  z.strictObject({ kind: kind('ready'), on: z.boolean() }),
  z.strictObject({ kind: kind('command'), requestId: count, command: commandSchema }),
  /** `seq`: the mirror's event count; without it, a whole snapshot. */
  z.strictObject({ kind: kind('resync'), seq: count.exactOptional() }),
  z.strictObject({ kind: kind('pong') }),
]);
export type GuestMessage = z.infer<typeof guestMessageSchema>;

/** What the host may send. */
export const hostMessageSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: kind('welcome'),
    sessionId: id,
    rulesetId: id,
    sport: id,
    resumeKey: id,
  }),
  z.strictObject({ kind: kind('refused'), reason: id }),
  z.strictObject({
    kind: kind('session'),
    peers: z
      .array(
        z.strictObject({
          name,
          teamId: teamId.nullable(),
          connected: z.boolean(),
          ready: z.boolean(),
          can: z.array(z.literal('advance')).max(1),
        }),
      )
      .max(32),
  }),
  z.strictObject({ kind: kind('snapshot.begin') }),
  z.strictObject({ kind: kind('snapshot.rows'), table: id, rows }),
  /** `seq`: the event count the rows stand at. `counts`: rows per table, all pieces together. */
  z.strictObject({ kind: kind('snapshot.end'), seq: count, counts }),
  /**
   * `seq`: the event count before the first of these. `last`: the command's events end here (a
   * long batch comes in pieces). `requestId`: to the guest whose command it was.
   */
  z.strictObject({
    kind: kind('events'),
    seq: count,
    events: z.array(event),
    last: z.boolean(),
    requestId: count.exactOptional(),
  }),
  z.strictObject({
    kind: kind('rejected'),
    requestId: count,
    error: z.strictObject({
      code: z.enum(['not_allowed', 'invalid', 'not_implemented']),
      message: z.string().max(500).refine(isSafeText, unsafe),
    }),
  }),
  z.strictObject({ kind: kind('ping') }),
  z.strictObject({ kind: kind('bye'), reason: id }),
]);
export type HostMessage = z.infer<typeof hostMessageSchema>;

/** A message, by the side that sent it. */
export interface WireMessages {
  guest: GuestMessage;
  host: HostMessage;
}
const SCHEMAS = { guest: guestMessageSchema, host: hostMessageSchema };

/** The message the `from` side sent, or a throw that names the first fault. */
export function parseMessage<S extends keyof WireMessages>(
  from: S,
  input: unknown,
): WireMessages[S] {
  const parsed = SCHEMAS[from].safeParse(input);
  if (parsed.success) return parsed.data as WireMessages[S];
  const issue = parsed.error.issues[0];
  // Cut short: the fault can quote the sender's own text.
  const message = `bad message: ${issue?.path.join('.') || 'message'}: ${issue?.message}`;
  throw new Error(message.slice(0, 200));
}
