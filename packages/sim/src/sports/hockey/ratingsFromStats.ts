import { isGoalie } from '@gm/shared';
import { clampRating } from '../../players';
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

/**
 * The features, in the order the coefficients use them. Rates and shares, so season length
 * drops out. The per-game rates and the workload terms let a rate count for more when it rests
 * on more ice time or more games (a starter's save % says more than a backup's).
 */
function skaterFeatures(t: SkaterTotals, seasonGames: number): number[] {
  const per60 = (n: number) => (t.toi > 0 ? (60 * n) / t.toi : 0);
  const perGame = (n: number) => (t.gp > 0 ? n / t.gp : 0);
  const toi = perGame(t.toi);
  return [
    toi,
    per60(t.goals),
    per60(t.assists),
    per60(t.shots),
    per60(t.plusMinus),
    perGame(t.goals),
    perGame(t.assists),
    perGame(t.shots),
    perGame(t.plusMinus),
    toi * toi,
    t.gp / seasonGames,
  ];
}

function goalieFeatures(t: GoalieTotals, seasonGames: number): number[] {
  const savePct = t.shotsAgainst > 0 ? t.saves / t.shotsAgainst : 0;
  const share = t.gp / seasonGames;
  return [savePct, share, savePct * share, t.gp > 0 ? t.shotsAgainst / t.gp : 0];
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
  /** 2: the per-game and workload features above (1 had rates only). */
  version: 2;
  source: string;
  groups: Record<RatingGroup, Record<string, RatingFit>>;
}

interface RatingEstimate {
  value: number;
  sd: number;
}

/**
 * A full sample, as a share of the season's games: the fit uses players at or above it, and a
 * smaller sample is pulled toward the position average in proportion.
 */
export const FULL_SAMPLE = { skater: 0.5, goalie: 0.25 };

/** A fitted linear model's value: the intercept (`coef[0]`) plus one coefficient per input. */
export const linear = (coef: readonly number[], x: readonly number[]): number =>
  coef.reduce((s, c, i) => s + c * (i === 0 ? 1 : x[i - 1]!), 0);

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
      : skaterFeatures(totals as SkaterTotals, seasonGames),
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
    const full = linear(fit.coef, features);
    const value = fit.mean + w * (full - fit.mean);
    out[key] = {
      value: clampRating(value),
      sd: Math.round(10 * Math.sqrt(w * fit.residualSd ** 2 + (1 - w) * fit.priorSd ** 2)) / 10,
    };
  }
  return out;
}
