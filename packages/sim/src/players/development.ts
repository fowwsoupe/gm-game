import type { Player } from '@gm/shared';
import type { Rng } from '../core';

/**
 * A player's career shape, drawn once (from distributions learned from real careers) and
 * stored with him. Development is never a straight line: this shape plus yearly noise
 * decides his path.
 */
export interface CareerShape {
  /** Age when he reaches his peak (early ~23, normal ~26, late ~29). */
  peakAge: number;
  /** Seasons he stays near his peak. */
  primeLength: number;
  /** How fast he declines after the prime (0 slow – 1 fast). */
  declineRate: number;
}

/** Plug-in point for development. The ML-trained model implements the same interface. */
export interface DevelopmentModel {
  /** Returns the player after one offseason of development. Must use only `rng` for randomness. */
  developOneYear(player: Player, age: number, rng: Rng): Player;
  /** Chance (0–1) that the player retires this offseason, at the age he is about to turn. */
  retirementChance(player: Player, age: number): number;
}

/** Average of a player's ratings: the one number the offseason uses to rank players. */
export function overall(player: Player): number {
  const values = Object.values(player.ratings);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 50;
}

/** How one kind of player (a position) ages. Ages are the age in the season about to start. */
export interface AgingCurve {
  /** Until this age he closes the gap to his potential; the gap is gone by this age. */
  peakAge: number;
  /** First age of decline; between peakAge and this he holds steady. */
  declineAge: number;
  /** Rating points lost in the first year of decline, then `declineStep` more each year. */
  declineStart: number;
  declineStep: number;
  /** Yearly luck (standard deviation, in rating points) shared by all of a player's ratings. */
  noise: number;
}

export interface RulesDevelopmentConfig {
  /** By position code; positions not listed use `fallback`. */
  curves: Record<string, AgingCurve>;
  fallback: AgingCurve;
  retirement: {
    /** Retirement chance is zero before this age... */
    startAge: number;
    /** ...then rises by this much each year, before the rating adjustment. */
    perYear: number;
    /** Everyone retires at this age. */
    maxAge: number;
    /** Below this overall rating, players aged 25+ also wash out (chance per point below). */
    washoutRating: number;
    washoutPerPoint: number;
    /** Extra chance for a player aged 25+ with no team after free agency (he gives up). */
    unsignedExtra: number;
  };
}

const clamp = (n: number) => Math.max(1, Math.min(99, Math.round(n)));

/**
 * Rules-based default: young players close the gap to their potential at a steady pace, hold
 * steady through their peak, then lose a little more each year. Numbers per position come
 * from the sport (hockey: sports/hockey/aging.ts, from docs/research).
 */
export function rulesDevelopment(config: RulesDevelopmentConfig): DevelopmentModel {
  const curve = (p: Player) => config.curves[p.position] ?? config.fallback;
  return {
    developOneYear(player, age, rng) {
      const c = curve(player);
      let delta: number;
      if (age <= c.peakAge) {
        const gap = Math.max(0, player.potential - overall(player));
        delta = gap / (c.peakAge - age + 1);
      } else if (age < c.declineAge) {
        delta = 0;
      } else {
        delta = -(c.declineStart + c.declineStep * (age - c.declineAge));
      }
      const luck = rng.normal(0, c.noise);
      const ratings: Record<string, number> = {};
      for (const [key, value] of Object.entries(player.ratings)) {
        ratings[key] = clamp(value + delta + luck + rng.normal(0, 1));
      }
      return { ...player, ratings };
    },

    retirementChance(player, age) {
      const r = config.retirement;
      if (age >= r.maxAge) return 1;
      const ovr = overall(player);
      const ageTerm = Math.max(0, age - r.startAge + 1) * r.perYear;
      // Good players hang on longer, weak ones leave sooner.
      const skill = Math.min(2, Math.max(0.4, 1 + (60 - ovr) / 30));
      const washout = age >= 25 ? Math.max(0, r.washoutRating - ovr) * r.washoutPerPoint : 0;
      const unsigned = age >= 25 && player.teamId === null ? r.unsignedExtra : 0;
      return Math.min(1, ageTerm * skill + washout + unsigned);
    },
  };
}
