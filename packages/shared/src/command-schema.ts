import { z } from 'zod';
import { STOP_CATEGORIES, type Command, type CommandError } from './commands';
import type { PlayerId, TeamId } from './domain';
import { GOALIE_ROTATIONS, SPECIAL_UNITS } from './sports/hockey';

/**
 * Commands as untrusted data. A command can come from another machine (a guest of a hosted
 * league), so nothing runs one before `parseCommand` has passed it: an unknown kind, an extra key,
 * a wrong type, a non-finite number, an oversized string or list and an unsafe string are all
 * refused. The local renderer's commands go through the same check.
 *
 * The bounds here keep a command sane (types, sizes); they are not league rules. The engine still
 * checks every rule against the ruleset.
 *
 * `commandSchema` is kept equal to the `Command` type: `command-schema.test.ts` fails
 * `pnpm typecheck` when a command kind or field has no schema.
 */

const PROTOTYPE_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype));

/**
 * The string rule. The engine indexes plain objects by id (`state.players[id]`), so a string that
 * names a property of `Object.prototype` (`__proto__`, `constructor`...) would read or write the
 * prototype instead of missing. No string in a message may be such a name or contain `__proto__`.
 */
export const isSafeText = (s: string) => !PROTOTYPE_NAMES.has(s) && !s.includes('__proto__');

/** An id is 1 to `ID_MAX` characters and passes the string rule. */
export const ID_MAX = 80;
const TEXT_MAX = 64;
const LIST_MAX = 1000;

const unsafe = 'a name the game cannot use';
const text = z.string().max(TEXT_MAX).refine(isSafeText, unsafe);
const id = z.string().min(1).max(ID_MAX).refine(isSafeText, unsafe);
const teamId = id as unknown as z.ZodType<TeamId>;
const playerId = id as unknown as z.ZodType<PlayerId>;
const players = z.array(playerId).max(LIST_MAX);
/** `<draft season>-<round>-<original team id>`: the engine splits it, so the team part is an id too. */
const picks = z
  .array(
    z
      .string()
      .max(ID_MAX + 16)
      .refine((s) => {
        const team = /^\d{1,4}-\d{1,2}-(.+)$/.exec(s)?.[1];
        return team !== undefined && isSafeText(team);
      }, 'not a pick id'),
  )
  .max(LIST_MAX);

/** Days, years, an index: a whole number small enough that nothing sized by it can hurt. */
const count = z.int().min(0).max(1000);
/** Whole dollars. */
const dollars = z.int().min(0);
/** A percentage or a market multiplier. */
const small = z.number().min(-1000).max(1000);
const flag = z.literal(true).exactOptional();

const identity = { city: text, name: text, abbreviation: text };
const department = z.enum(['scouting', 'development', 'medical', 'analytics', 'assistant']);
const proposal = z.strictObject({
  fromTeamId: teamId,
  toTeamId: teamId,
  give: players,
  get: players,
  retain: z
    .array(z.strictObject({ playerId, pct: small }))
    .max(LIST_MAX)
    .exactOptional(),
  givePicks: picks.exactOptional(),
  getPicks: picks.exactOptional(),
  giveProspects: players.exactOptional(),
  getProspects: players.exactOptional(),
  protectTop: count.exactOptional(),
});
const offer = {
  playerId,
  salary: dollars,
  years: count,
  noTrade: flag,
  bonusPct: small.exactOptional(),
};

const kind = <K extends Command['kind']>(k: K) => z.literal(k);

export const commandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: kind('sim.advance'),
    days: count,
    stopOn: z
      .union([
        z.enum(['never', 'major']),
        z.array(z.enum(STOP_CATEGORIES)).max(LIST_MAX).readonly(),
      ])
      .exactOptional(),
  }),
  z.strictObject({ kind: kind('team.setUserControlled'), teamId, userControlled: z.boolean() }),
  z.strictObject({ kind: kind('team.rename'), teamId, ...identity }),
  z.strictObject({ kind: kind('team.relocate'), teamId, ...identity, market: small }),
  z.strictObject({ kind: kind('league.expand'), ...identity, market: small }),
  z.strictObject({ kind: kind('commissioner.move'), playerId, teamId: teamId.nullable() }),
  z.strictObject({ kind: kind('season.rollover') }),
  z.strictObject({ kind: kind('contract.buyout'), playerId }),
  z.strictObject({ kind: kind('contract.resign'), ...offer }),
  z.strictObject({ kind: kind('contract.askWaiveNoTrade'), proposal }),
  z.strictObject({ kind: kind('trade.propose'), proposal }),
  z.strictObject({ kind: kind('trade.respond'), offerId: id, accept: z.boolean() }),
  z.strictObject({ kind: kind('tradeRequest.talk'), playerId }),
  z.strictObject({ kind: kind('holdout.talk'), playerId }),
  z.strictObject({
    kind: kind('dispute.talk'),
    playerId,
    answer: z.enum(['promise', 'patience', 'block']),
  }),
  z.strictObject({ kind: kind('offseason.openFreeAgency') }),
  z.strictObject({ kind: kind('lines.set'), teamId, order: players }),
  z.strictObject({
    kind: kind('units.set'),
    teamId,
    unit: z.enum(SPECIAL_UNITS),
    playerIds: players,
  }),
  z.strictObject({ kind: kind('training.set'), teamId, playerId, focus: text.nullable() }),
  z.strictObject({ kind: kind('delegate.set'), teamId, offers: z.boolean() }),
  z.strictObject({ kind: kind('trade.block'), teamId, playerId, onBlock: z.boolean() }),
  z.strictObject({ kind: kind('career.takeJob'), teamId }),
  z.strictObject({ kind: kind('league.setCanBeFired'), on: z.boolean() }),
  z.strictObject({
    kind: kind('league.setStopOn'),
    stopOn: z.array(z.enum(STOP_CATEGORIES)).max(LIST_MAX),
  }),
  z.strictObject({ kind: kind('owner.answerCard'), cardId: id, option: id }),
  z.strictObject({ kind: kind('finance.setTicketPrice'), teamId, pct: small }),
  z.strictObject({ kind: kind('staff.hire'), teamId, department, candidate: count }),
  z.strictObject({ kind: kind('staff.fire'), teamId, department }),
  z.strictObject({
    kind: kind('goalies.setRotation'),
    teamId,
    rotation: z.enum(GOALIE_ROTATIONS),
  }),
  z.strictObject({ kind: kind('draft.setBoard'), teamId, order: players }),
  z.strictObject({ kind: kind('offseason.startDraft') }),
  z.strictObject({ kind: kind('draft.pick'), teamId, playerId }),
  z.strictObject({ kind: kind('prospect.sign'), teamId, playerId }),
  z.strictObject({ kind: kind('player.assign'), teamId, playerId, down: z.boolean() }),
  z.strictObject({ kind: kind('freeAgency.advanceDay') }),
  z.strictObject({ kind: kind('freeAgency.matchSheet'), playerId, teamId }),
  z.strictObject({ kind: kind('freeAgency.declineSheet'), playerId, teamId }),
  z.strictObject({ kind: kind('contract.sign'), teamId, ...offer, promiseRole: flag }),
]);

/** The command in `input`, or the refusal a command gets (`invalid`, with the first fault). */
export function parseCommand(
  input: unknown,
): { ok: true; command: Command } | { ok: false; error: CommandError } {
  const parsed = commandSchema.safeParse(input);
  if (parsed.success) return { ok: true, command: parsed.data };
  const issue = parsed.error.issues[0];
  // Cut short: the fault can quote the sender's own text.
  const message = `bad command: ${issue?.path.join('.') || 'command'}: ${issue?.message}`;
  return { ok: false, error: { code: 'invalid', message: message.slice(0, 200) } };
}
