import { z } from 'zod';

/**
 * Format for community roster files (JSON). Real rosters come from the community,
 * so treat every file as untrusted: validate here before anything touches a save.
 * Bump ROSTER_FORMAT_VERSION on breaking changes and write a migration.
 */
export const ROSTER_FORMAT_VERSION = 1;

const rating = z.number().int().min(1).max(99);

const skaterRatings = z.object({
  skating: rating,
  shooting: rating,
  passing: rating,
  puckHandling: rating,
  defense: rating,
  physical: rating,
  hockeyIq: rating,
});

const goalieRatings = z.object({
  reflexes: rating,
  positioning: rating,
  reboundControl: rating,
  consistency: rating,
});

const rosterPlayer = z
  .object({
    id: z.string().min(1),
    firstName: z.string().min(1).max(60),
    lastName: z.string().min(1).max(60),
    birthYear: z.number().int().min(1950).max(2020),
    team: z.string().min(1).nullable(),
    position: z.enum(['C', 'LW', 'RW', 'D', 'G']),
    potential: rating,
    skater: skaterRatings.optional(),
    goalie: goalieRatings.optional(),
    contract: z
      .object({
        capHit: z.number().int().nonnegative(),
        expiresAfterSeason: z.number().int(),
      })
      .optional(),
  })
  .refine((p) => (p.position === 'G' ? p.goalie !== undefined : p.skater !== undefined), {
    message: 'Goalies need goalie ratings and skaters need skater ratings',
  });

const rosterTeam = z.object({
  abbreviation: z.string().min(2).max(4),
  city: z.string().min(1),
  name: z.string().min(1),
});

export const rosterFileSchema = z
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

export function parseRosterFile(json: unknown) {
  return rosterFileSchema.safeParse(json);
}
