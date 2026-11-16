import { isGoalie } from '@gm/shared';

/**
 * Hockey builds and role tags from a player's percentiles (0–100 within his group). A plain rule
 * for now: the build is the profile his best skills fit; tags mark standout single skills.
 * TODO(M4, Azmi): builds found by clustering real players, replacing these rules.
 */
type Pct = Record<string, number>;

const mean = (p: Pct, keys: string[]) => keys.reduce((s, k) => s + (p[k] ?? 50), 0) / keys.length;

/** Candidate builds per group, scored by how well the player's profile fits each. */
const FORWARD_BUILDS: Record<string, (p: Pct) => number> = {
  sniper: (p) => p.shooting! * 1.2 - 0.2 * (p.defense ?? 50),
  playmaker: (p) => mean(p, ['passing', 'hockeyIq']) * 1.15 - 0.15 * (p.physical ?? 50),
  powerForward: (p) => mean(p, ['physical', 'shooting']) * 1.1,
  twoWay: (p) => mean(p, ['defense', 'hockeyIq', 'passing']),
  grinder: (p) => mean(p, ['physical', 'defense']) * 1.05 - 0.1 * (p.shooting ?? 50),
};
const DEFENCE_BUILDS: Record<string, (p: Pct) => number> = {
  offensiveD: (p) => mean(p, ['passing', 'skating', 'puckHandling']) * 1.1,
  shutdownD: (p) => mean(p, ['defense', 'physical']) * 1.1,
  twoWayD: (p) => mean(p, ['defense', 'passing', 'hockeyIq']),
};
const GOALIE_BUILDS: Record<string, (p: Pct) => number> = {
  athleticG: (p) => p.reflexes! * 1.1,
  positionalG: (p) => mean(p, ['positioning', 'reboundControl']) * 1.1,
};

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

export function hockeyRole(
  position: string,
  percentiles: readonly { key: string; value: number }[],
): { build: string; tags: string[] } {
  const p: Pct = Object.fromEntries(percentiles.map((x) => [x.key, x.value]));
  const builds = isGoalie(position)
    ? GOALIE_BUILDS
    : position === 'D'
      ? DEFENCE_BUILDS
      : FORWARD_BUILDS;
  const build = Object.entries(builds).sort(
    ([a, fa], [b, fb]) => fb(p) - fa(p) || a.localeCompare(b),
  )[0]![0];
  const tags = percentiles
    .filter((x) => x.value >= TAG_PERCENTILE && TAGS[x.key])
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((x) => TAGS[x.key]!);
  return { build, tags };
}
