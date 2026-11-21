import { z } from 'zod';
import { GOALIE_RATINGS, HOCKEY_POSITIONS, SKATER_RATINGS } from './sports/hockey';

/**
 * Format for community roster files (JSON). Real rosters come from the community,
 * so treat every file as untrusted: validate here before anything touches a save.
 * Bump ROSTER_FORMAT_VERSION on breaking changes and upgrade older files in upgradeRosterFile.
 * v2: skaters gained `faceoffs`.
 * A player may carry one season of `stats` instead of ratings; the sim rates him from them.
 * A skater's stats may also carry `pkToi` and `pim` (together, optional, so older files still
 * load): with them his `defense` and `physical` are rated more sharply.
 * A team may carry `colors` (`primary` and `secondary`, each `#rrggbb`; optional, so older files
 * still load): the match viewer draws its discs in them.
 */
export const ROSTER_FORMAT_VERSION = 2;

const rating = z.number().int().min(1).max(99);
const ratingsOf = <K extends string>(keys: readonly K[]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, rating])) as Record<K, typeof rating>);

const skaterRatings = ratingsOf(SKATER_RATINGS);
const goalieRatings = ratingsOf(GOALIE_RATINGS);

const count = z.number().int().min(0).max(5000);
const skaterStats = z.object({
  gp: count,
  goals: count,
  assists: count,
  shots: count,
  plusMinus: z.number().int().min(-500).max(500),
  /** Minutes on ice. */
  toi: z.number().min(0).max(10000),
  /** Minutes on the penalty kill (part of `toi`). */
  pkToi: z.number().min(0).max(10000).optional(),
  /** Penalty minutes. */
  pim: count.optional(),
});
const goalieStats = z.object({ gp: count, shotsAgainst: count, saves: count });

const rosterPlayer = z
  .object({
    id: z.string().min(1),
    firstName: z.string().min(1).max(60),
    lastName: z.string().min(1).max(60),
    birthYear: z.number().int().min(1950).max(2020),
    team: z.string().min(1).nullable(),
    position: z.enum(HOCKEY_POSITIONS),
    potential: rating,
    skater: skaterRatings.optional(),
    goalie: goalieRatings.optional(),
    stats: z.union([skaterStats, goalieStats]).optional(),
    contract: z
      .object({
        capHit: z.number().int().nonnegative(),
        expiresAfterSeason: z.number().int(),
      })
      .optional(),
  })
  .refine(
    (p) =>
      p.position === 'G'
        ? p.goalie !== undefined || (p.stats !== undefined && 'saves' in p.stats)
        : p.skater !== undefined || (p.stats !== undefined && 'toi' in p.stats),
    { message: 'Goalies need goalie ratings (or goalie stats), skaters skater ratings (or stats)' },
  )
  .refine(
    (p) =>
      !p.stats ||
      !('toi' in p.stats) ||
      (p.stats.pkToi === undefined) === (p.stats.pim === undefined),
    { message: 'Skater stats carry pkToi and pim together, or neither', path: ['stats'] },
  );

const colour = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'A colour is # and six hex digits, like #1a2b3c');

const rosterTeam = z.object({
  abbreviation: z.string().min(2).max(4),
  city: z.string().min(1),
  name: z.string().min(1),
  conference: z.string().min(1).optional(),
  division: z.string().min(1).optional(),
  colors: z.object({ primary: colour, secondary: colour }).optional(),
});

const rosterFileSchema = z
  .object({
    formatVersion: z.literal(ROSTER_FORMAT_VERSION),
    sport: z.literal('nhl'),
    season: z.number().int(),
    name: z.string().min(1).max(100),
    author: z.string().max(100).optional(),
    teams: z.array(rosterTeam).min(2).max(64),
    players: z.array(rosterPlayer).max(5000),
  })
  .superRefine((file, ctx) => {
    const abbrevs = new Set(file.teams.map((t) => t.abbreviation));
    const ids = new Set<string>();
    file.players.forEach((p, i) => {
      if (ids.has(p.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate player id ${p.id}`,
          path: ['players', i, 'id'],
        });
      }
      ids.add(p.id);
      if (p.team !== null && !abbrevs.has(p.team)) {
        ctx.addIssue({
          code: 'custom',
          message: `Unknown team ${p.team}`,
          path: ['players', i, 'team'],
        });
      }
    });
  });

export type RosterFile = z.infer<typeof rosterFileSchema>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Brings an older roster file up to the current format before validation. The file is untrusted,
 * so anything unexpected is passed through unchanged for the schema to reject.
 * v1 -> v2: each skater's `faceoffs` starts at the average of his other ratings, so his overall
 * does not move.
 */
function upgradeRosterFile(json: unknown): unknown {
  if (!isRecord(json) || json.formatVersion !== 1 || !Array.isArray(json.players)) return json;
  return {
    ...json,
    formatVersion: 2,
    players: json.players.map((p: unknown) => {
      if (!isRecord(p) || !isRecord(p.skater) || 'faceoffs' in p.skater) return p;
      const values = Object.values(p.skater).filter((v): v is number => typeof v === 'number');
      if (values.length === 0) return p;
      const faceoffs = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
      return { ...p, skater: { ...p.skater, faceoffs } };
    }),
  };
}

export function parseRosterFile(json: unknown) {
  return rosterFileSchema.safeParse(upgradeRosterFile(json));
}
