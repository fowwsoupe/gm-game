import {
  GOALIE_RATINGS,
  SKATER_RATINGS,
  type HockeyPosition,
  type Player,
  type PlayerId,
  type Team,
  type TeamId,
} from '@gm/shared';
import { payroll, type Ruleset } from '../../cba';
import { FIRST, LAST, pct, type Rng } from '../../core';
import { clampRating } from '../../players';
import { SHAPE_POINTS, SKATER_BUILD_CLUSTERS } from './tuning';

const CITIES = [
  'Aurora',
  'Bayview',
  'Cedar Falls',
  'Dunmore',
  'Eastport',
  'Fairhaven',
  'Glenrock',
  'Harbor City',
  'Ironwood',
  'Juniper',
  'Kingsbridge',
  'Lakeshore',
  'Maple Ridge',
  'Northgate',
  'Oakmont',
  'Pinecrest',
];
const NAMES = [
  'Wolves',
  'Comets',
  'Blizzard',
  'Lumberjacks',
  'Admirals',
  'Foxes',
  'Thunder',
  'Ravens',
  'Miners',
  'Sentinels',
  'Stallions',
  'Pilots',
  'Grizzlies',
  'Owls',
  'Storm',
  'Knights',
];

const ROSTER: HockeyPosition[] = [
  ...Array<HockeyPosition>(5).fill('C'),
  ...Array<HockeyPosition>(5).fill('LW'),
  ...Array<HockeyPosition>(5).fill('RW'),
  ...Array<HockeyPosition>(8).fill('D'),
  'G',
  'G',
];

/** Draft class mix: about 10% goalies, 30% defensemen. */
const DRAFT_POSITIONS: HockeyPosition[] = [
  'C',
  'C',
  'C',
  'LW',
  'LW',
  'RW',
  'RW',
  'D',
  'D',
  'D',
  'G',
];
/**
 * Prospect tuning: potential = base + two dice of 0-15; today's rating is potential minus a gap.
 * The base and the fictional league's starting ages (20-34) are set together so that a league
 * 20 years on, built only from prospects, has the average rating it started with (balance lab,
 * "League avg rating drift"). 52 until picks waited in the prospect pool: with the teenagers off
 * the rosters the rostered average drifted up 3.5 by year 15 (4 leagues); 48 keeps the largest
 * drift at 2.3-2.7 (seeds 1, 101, 201).
 */
const PROSPECT = { potentialBase: 48, gap: [12, 26] as const };

/** One value per rating key, drawn in the order the keys are listed. */
const rate = (keys: readonly string[], r: (key: string) => number) =>
  Object.fromEntries(keys.map((k) => [k, r(k)]));

/** Variance of the +-8 die every key had before builds: a key's shape and die add up to it. */
const KEY_VARIANCE = (17 ** 2 - 1) / 12;

/**
 * Each build's offset per skater key in rating points, centred on the share-weighted mean so the
 * league's average rating does not move, and the die left per key so its spread does not either.
 */
function shapes(clusters: readonly { share: number; centre: Partial<Record<string, number>> }[]) {
  const centre = (c: (typeof clusters)[number], k: string) => c.centre[k] ?? 0;
  const mean = (k: string) => clusters.reduce((s, c) => s + c.share * centre(c, k), 0);
  const builds = clusters.map((c) => ({
    share: c.share,
    offset: Object.fromEntries(
      SKATER_RATINGS.map((k) => [k, SHAPE_POINTS * (centre(c, k) - mean(k))]),
    ),
  }));
  const die = Object.fromEntries(
    SKATER_RATINGS.map((k) => [
      k,
      Math.sqrt(KEY_VARIANCE - builds.reduce((s, b) => s + b.share * b.offset[k]! ** 2, 0)),
    ]),
  );
  return { builds, die };
}
const SHAPES = {
  forwards: shapes(SKATER_BUILD_CLUSTERS.forwards),
  defence: shapes(SKATER_BUILD_CLUSTERS.defence),
};

/**
 * A new player's ratings around `base`. A skater is born with a build drawn by its share of real
 * skaters; goalies keep plain dice (their public stats are too noisy to cluster).
 */
function ratingsFor(position: HockeyPosition, base: number, rng: Rng) {
  if (position === 'G') return rate(GOALIE_RATINGS, () => clampRating(base + rng.int(-8, 8)));
  const { builds, die } = position === 'D' ? SHAPES.defence : SHAPES.forwards;
  let u = rng.next();
  const build = builds.find((b) => (u -= b.share) < 0) ?? builds.at(-1)!;
  return rate(SKATER_RATINGS, (k) => clampRating(base + build.offset[k]! + rng.normal(0, die[k]!)));
}

/**
 * Fictional league for development and for players who don't load a community roster.
 * Real rosters come from roster JSON files (see @gm/shared roster-schema).
 */
export function generateFictionalLeague(
  rng: Rng,
  ruleset: Ruleset,
): { teams: Team[]; players: Player[] } {
  const teamCount = 16;
  const teams: Team[] = [];
  const players: Player[] = [];
  let level = 0;
  for (let t = 0; t < teamCount; t++) {
    const city = CITIES[t % CITIES.length]!;
    const id = `t${t}` as TeamId;
    teams.push({
      id,
      city,
      name: NAMES[t % NAMES.length]!,
      abbreviation: city.slice(0, 3).toUpperCase(),
      // Two conferences, each split into divisions of four.
      conference: t % 2 === 0 ? 'East' : 'West',
      division: `${t % 2 === 0 ? 'East' : 'West'} ${Math.floor(t / 2 / 4) % 2 === 0 ? 'A' : 'B'}`,
      userControlled: t === 0,
    });

    // A team's edge in rating points. At +-8 a new league's playoffs were more lopsided than a
    // settled league's (balance lab: better team won 65% of series against 63% from year 10 on).
    const quality = rng.int(-6, 6);
    level += quality / teamCount;
    const teamStart = players.length;
    for (const position of ROSTER) {
      const base = 62 + quality + rng.int(-10, 12);
      const p: Player = {
        id: `p${players.length}` as PlayerId,
        firstName: rng.pick(FIRST),
        lastName: rng.pick(LAST),
        birthYear: rng.int(1993, 2007),
        teamId: id,
        position,
        ratings: {},
        potential: clampRating(base + rng.int(0, 15)),
        contract: { capHit: rng.int(8, 100) * 100_000, expiresAfterSeason: 2027 + rng.int(0, 5) },
      };
      p.ratings = ratingsFor(position, base, rng);
      players.push(p);
    }
    fitPayroll(players.slice(teamStart), ruleset, rng.fork(`payroll${t}`));
  }
  // Every league starts at the same level, whatever the dice gave its teams: strong and weak
  // teams around an average one.
  for (const p of players) {
    for (const k of Object.keys(p.ratings)) p.ratings[k] = clampRating(p.ratings[k]! - level);
    p.potential = clampRating(p.potential - level);
  }
  return { teams, players };
}

/**
 * Scales a team's random cap hits so the payroll is a legal 80-92% of the cap
 * (with every salary at or above the league minimum), instead of whatever the dice gave.
 */
function fitPayroll(roster: Player[], ruleset: Ruleset, rng: Rng) {
  const { upperLimit, minSalary } = ruleset.cap;
  const target = pct(upperLimit, rng.int(80, 92));
  const total = payroll(roster);
  for (const p of roster) {
    const scaled = Math.round((p.contract!.capHit * target) / total / 100_000) * 100_000;
    p.contract!.capHit = Math.max(minSalary, scaled);
  }
}

/**
 * Where a draft prospect comes from: most from Canadian junior, the rest from European men's
 * leagues. ponytail: about two to one from general knowledge (college is out of scope); a share
 * per league from real draft classes when the data rights allow.
 */
const JUNIOR_SHARE = 0.65;

export const hockeyProspectOrigin = (rng: Rng) => (rng.chance(JUNIOR_SHARE) ? 'junior' : 'europe');

/** A junior past the junior age plays in a European men's league until he signs. */
export const hockeyProspectLeague = (origin: string, age: number, rules: Ruleset) =>
  origin === 'junior' && age > rules.draft.juniorMaxAge ? 'europe' : origin;

/**
 * A new, teamless 18-19 year old: the draft class and undrafted free agents.
 * Rated well below his potential; development closes the gap by his mid-twenties.
 */
export function generateProspect(
  rng: Rng,
  opts: { id: string; season: number; position?: string },
): Player {
  const position = (opts.position ?? rng.pick(DRAFT_POSITIONS)) as HockeyPosition;
  const potential = clampRating(PROSPECT.potentialBase + rng.int(0, 15) + rng.int(0, 15));
  const base = potential - rng.int(PROSPECT.gap[0], PROSPECT.gap[1]);
  return {
    id: opts.id as PlayerId,
    firstName: rng.pick(FIRST),
    lastName: rng.pick(LAST),
    birthYear: opts.season - rng.int(18, 19),
    teamId: null,
    position,
    potential,
    ratings: ratingsFor(position, base, rng),
  };
}
