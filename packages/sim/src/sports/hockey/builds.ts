import { isGoalie, type Player } from '@gm/shared';
import { hash } from '../../people';
import { SHAPE_POINTS, SKATER_BUILD_CLUSTERS } from './tuning';

/**
 * Hockey builds and role tags from a player's percentiles (0–100 within his group). A skater's
 * build is the nearest real-player cluster to his shape (docs/research/2026-11-player-builds-evidence.md);
 * a goalie's is a plain rule. Tags mark standout single skills, then his play trait.
 */
type Pct = Record<string, number>;

const mean = (p: Pct, keys: string[]) => keys.reduce((s, k) => s + (p[k] ?? 50), 0) / keys.length;

const GOALIE_BUILDS: Record<string, (p: Pct) => number> = {
  athleticG: (p) => p.reflexes! * 1.1,
  positionalG: (p) => mean(p, ['positioning', 'reboundControl']) * 1.1,
};

/** The keys the clusters were found on. */
const SHAPE_KEYS = ['shooting', 'passing', 'physical', 'hockeyIq', 'defense'];
/**
 * Percentile points per SD of a centre: a rating point is about 4 percentile points mid-range (a
 * new league's skater keys spread about 9 points). Set so a new league's build shares match the
 * clusters' (sim.test).
 */
const PCT_PER_SD = SHAPE_POINTS * 4;

/** The nearest cluster to the player's shape: his percentiles minus their mean. */
function nearestBuild(position: string, p: Pct): string {
  const clusters =
    position === 'D' ? SKATER_BUILD_CLUSTERS.defence : SKATER_BUILD_CLUSTERS.forwards;
  const level = mean(p, SHAPE_KEYS);
  const distance = (centre: Partial<Record<string, number>>) =>
    SHAPE_KEYS.reduce((s, k) => s + ((p[k] ?? 50) - level - PCT_PER_SD * (centre[k] ?? 0)) ** 2, 0);
  return clusters
    .map((c) => ({ build: c.build, d: distance(c.centre) }))
    .sort((a, b) => a.d - b.d)[0]!.build;
}

/** Tags for single standout skills (top 10% of his group). */
const TAGS: Record<string, string> = {
  shooting: 'shot',
  skating: 'speed',
  passing: 'vision',
  physical: 'physical',
  faceoffs: 'faceoffs',
  defense: 'defender',
  consistency: 'steady',
  reflexes: 'reflexes',
};
const TAG_PERCENTILE = 90;

/**
 * Play traits: a style fixed for his career that both repeat in real data year to year (r
 * 0.6-0.75, docs/research/2026-11-player-builds-evidence.md). `shotSpread` scales the spread
 * of his shot distance draw (closer in / farther out), `penaltyWeight` his weight when the sim
 * picks who takes a penalty. Paired opposites at the same share keep the league's average.
 */
export const PLAY_TRAITS = {
  netFront: { shotSpread: 0.7, penaltyWeight: 1 },
  perimeter: { shotSpread: 1.3, penaltyWeight: 1 },
  disciplined: { shotSpread: 1, penaltyWeight: 2 / 3 },
  undisciplined: { shotSpread: 1, penaltyWeight: 1.5 },
} as const;
export type PlayTrait = keyof typeof PLAY_TRAITS;
/** Percent of skaters with each trait: four traits, one skater in five has one. */
const TRAIT_SHARE = 5;
const NO_TRAIT = { shotSpread: 1, penaltyWeight: 1 };

/** A skater's play trait, if any: from his id like his personality, nothing stored. */
export function playTraitOf(playerId: string, position: string): PlayTrait | undefined {
  if (isGoalie(position)) return undefined;
  const traits = Object.keys(PLAY_TRAITS) as PlayTrait[];
  return traits[Math.floor((hash(`playTrait:${playerId}`) % 100) / TRAIT_SHARE)];
}

export const traitLevers = (p: Player): { shotSpread: number; penaltyWeight: number } => {
  const t = playTraitOf(p.id, p.position);
  return t ? PLAY_TRAITS[t] : NO_TRAIT;
};

export function hockeyRole(
  position: string,
  percentiles: readonly { key: string; value: number }[],
  playerId: string,
): { build: string; tags: string[] } {
  const p: Pct = Object.fromEntries(percentiles.map((x) => [x.key, x.value]));
  const build = isGoalie(position)
    ? Object.entries(GOALIE_BUILDS).sort(
        ([a, fa], [b, fb]) => fb(p) - fa(p) || a.localeCompare(b),
      )[0]![0]
    : nearestBuild(position, p);
  const tags = percentiles
    .filter((x) => x.value >= TAG_PERCENTILE && TAGS[x.key])
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((x) => TAGS[x.key]!);
  const trait = playTraitOf(playerId, position);
  return { build, tags: trait ? [...tags, trait] : tags };
}
