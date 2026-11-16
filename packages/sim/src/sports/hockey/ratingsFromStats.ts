import { isGoalie } from '@gm/shared';
import type { GoalieTotals, SkaterTotals } from './stats';

/**
 * Stats to ratings: estimates a player's hidden ratings from one season's stat line, so a
 * community roster can be rated from stats. Calibrated on the sim itself (`pnpm ratings:fit`
 * plays many seasons and fits each rating on the stat lines it produced), so it maps a stat
 * line onto this game's rating scale. A real NHL line converts as well as the sim's league
 * matches the NHL (the balance lab checks scoring, shots and save %).
 *
 * Every estimate carries an uncertainty (`sd`, rating points). Ratings that a stat line barely
 * shows (low R² in the table) come back near the position average with a wide `sd`. A short
 * season is pulled toward the average too, by its share of a full sample (`FULL_SAMPLE`).
 */

export type RatingGroup = 'F' | 'D' | 'G';
export const ratingGroup = (position: string): RatingGroup =>
  isGoalie(position) ? 'G' : position === 'D' ? 'D' : 'F';

/** Feature names, in the order the coefficients use them. Rates, so season length drops out. */
export const SKATER_FEATURES = [
  'toiPerGame',
  'goalsPer60',
  'assistsPer60',
  'shotsPer60',
  'plusMinusPer60',
] as const;
export const GOALIE_FEATURES = ['savePct', 'gamesShare'] as const;

export function skaterFeatures(t: SkaterTotals): number[] {
  const per60 = (n: number) => (t.toi > 0 ? (60 * n) / t.toi : 0);
  return [
    t.gp > 0 ? t.toi / t.gp : 0,
    per60(t.goals),
    per60(t.assists),
    per60(t.shots),
    per60(t.plusMinus),
  ];
}

export function goalieFeatures(t: GoalieTotals, seasonGames: number): number[] {
  return [t.shotsAgainst > 0 ? t.saves / t.shotsAgainst : 0, t.gp / seasonGames];
}

export interface RatingFit {
  /** Intercept first, then one per feature. */
  coef: number[];
  /** Position average and spread: what an empty stat line falls back to. */
  mean: number;
  priorSd: number;
  /** Error of a full-season estimate, from held-out leagues. */
  residualSd: number;
  /** Share of the rating's spread a full season explains (held out). */
  r2: number;
}

export interface StatsToRatingsTable {
  format: 'gm-stats-to-ratings';
  version: 1;
  source: string;
  groups: Record<RatingGroup, Record<string, RatingFit>>;
}

export interface RatingEstimate {
  value: number;
  sd: number;
}

/**
 * A full sample, as a share of the season's games: the fit uses players at or above it, and a
 * smaller sample is pulled toward the position average in proportion.
 */
export const FULL_SAMPLE = { skater: 0.5, goalie: 0.25 };

/** The stat features and how much of a full sample they rest on (0-1). */
export function statFeatures(
  position: string,
  totals: SkaterTotals | GoalieTotals,
  seasonGames: number,
): { features: number[]; share: number } {
  const goalie = isGoalie(position);
  const full = (goalie ? FULL_SAMPLE.goalie : FULL_SAMPLE.skater) * seasonGames;
  return {
    features: goalie
      ? goalieFeatures(totals as GoalieTotals, seasonGames)
      : skaterFeatures(totals as SkaterTotals),
    share: Math.min(1, totals.gp / full),
  };
}

/**
 * Estimates each rating of the player's position from one season's totals (the same totals
 * `hockeySeasonStats` adds up). With no games the answer is the position average and its full
 * spread as the uncertainty.
 */
export function ratingsFromStats(
  table: StatsToRatingsTable,
  position: string,
  totals: SkaterTotals | GoalieTotals,
  seasonGames: number,
): Record<string, RatingEstimate> {
  const { features, share: w } = statFeatures(position, totals, seasonGames);
  const out: Record<string, RatingEstimate> = {};
  for (const [key, fit] of Object.entries(table.groups[ratingGroup(position)])) {
    const full = fit.coef.reduce((s, c, i) => s + c * (i === 0 ? 1 : features[i - 1]!), 0);
    const value = fit.mean + w * (full - fit.mean);
    out[key] = {
      value: Math.max(1, Math.min(99, Math.round(value))),
      sd: Math.round(10 * Math.sqrt(w * fit.residualSd ** 2 + (1 - w) * fit.priorSd ** 2)) / 10,
    };
  }
  return out;
}
