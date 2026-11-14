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
}

/** Placeholder until the real model exists: players don't change. */
export const noDevelopment: DevelopmentModel = {
  developOneYear: (player) => player,
};
