import type { Player, TeamStatus } from '@gm/shared';
import type { Dollars } from '../core';

/**
 * What a team knows about itself when it values a player. Value is per team, never one
 * global number: a rental is worth a lot to a contender and little to a rebuilder.
 */
export interface TeamContext {
  status: TeamStatus;
  capSpace: Dollars;
  /** Positions or roles the team is short of, e.g. ['RD']. */
  needs: string[];
}

export interface Valuation {
  /** On-ice value over the contract minus its cost. Can be negative. */
  surplus: Dollars;
  /** Human-readable reasons, shown by the AI when it accepts or rejects. */
  reasons: string[];
}

/** Plug-in point for player value. The ML-trained model implements the same interface. */
export interface PlayerValuator {
  value(player: Player, team: TeamContext): Valuation;
}

/**
 * Placeholder valuation so the plumbing works end to end. Deliberately crude.
 * TODO(feature): surplus over contract term, age curve, scarcity, team status, pick value.
 */
export const naiveValuator: PlayerValuator = {
  value(player) {
    const r = player.skater ?? player.goalie;
    const avg = r ? Object.values(r).reduce((a, b) => a + b, 0) / Object.values(r).length : 50;
    const worth = Math.max(0, (avg - 55) * 300_000);
    const cost = player.contract?.capHit ?? 0;
    return { surplus: Math.round(worth - cost), reasons: ['placeholder valuation'] };
  },
};
