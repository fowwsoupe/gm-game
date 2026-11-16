import type { Player, TeamStatus } from '@gm/shared';
import type { Dollars } from '../core';
import type { Ruleset } from '../cba';
import { overall } from '../players';
import { salaryForOverall } from './market';

/**
 * What a team knows about itself when it values a player. Value is per team, never one
 * global number: a rental is worth a lot to a contender and little to a rebuilder.
 */
export interface TeamContext {
  status: TeamStatus;
  /** The season the team is planning for (next season once the champion is crowned). */
  season: number;
  /** Share of that season still to play, 0–1 (1 before it starts): rentals lose value as it runs out. */
  seasonLeft: number;
  capSpace: Dollars;
  /** Positions the team is short of, e.g. ['D']. */
  needs: string[];
  /** The GM's lean, -1 (builder: the future) to 1 (win now). Absent or 0: the situation alone. */
  lean?: number;
}

export type ValueReason = 'negative_contract' | 'rental' | 'prospect' | 'fills_need';

export interface Valuation {
  /** On-ice value over the contract (and team control after it) minus its cost. Can be negative. */
  surplus: Dollars;
  /** Why, as codes the UI translates and the AI quotes when it accepts or rejects. */
  reasons: ValueReason[];
}

/** Plug-in point for player value. The ML-trained model implements the same interface. */
export interface PlayerValuator {
  value(player: Player, team: TeamContext, rules: Ruleset): Valuation;
}

/**
 * How much a team cares about this season (`now`) versus each later one (`later` per year).
 * Contenders spend the future on today; rebuilders the other way round.
 */
const HORIZON: Record<TeamStatus, { now: number; later: number }> = {
  contender: { now: 1.25, later: 0.6 },
  buyer: { now: 1.1, later: 0.75 },
  bubble: { now: 1, later: 0.85 },
  seller: { now: 0.7, later: 0.9 },
  rebuilder: { now: 0.45, later: 0.95 },
  crisis: { now: 0.6, later: 0.9 },
};

/** How far a GM's lean moves this season's weight, and each later season's. */
const LEAN_NOW = 0.2;
const LEAN_LATER = 0.06;

/** After his deal a restricted player re-signs this far below his worth. */
const CONTROL_DISCOUNT = 0.25;
/** Restricted years counted at most. */
const MAX_CONTROL_YEARS = 3;
/**
 * A dollar of cap hit costs less than a dollar of on-ice worth: cap room cannot always be turned
 * back into talent. So a star on a fair deal is still worth having, and only a contract well
 * above a player's worth goes negative.
 */
const CAP_DOLLAR_COST = 0.75;
/** Extra worth when he plays a position the team is short of. */
const NEED_BONUS = 0.1;

/**
 * Expected overall `years` from now. A rough sport-neutral curve (young players close on their
 * potential, players past 30 fade); the development model owns the real one.
 */
export function projectedOverall(player: Player, age: number, years: number): number {
  let rating = overall(player);
  for (let y = 1; y <= years; y++) {
    const a = age + y;
    if (a <= 26) rating += Math.max(0, player.potential - rating) / Math.max(1, 27 - a);
    else if (a >= 31) rating -= 1 + 0.5 * (a - 31);
  }
  return rating;
}

/**
 * Rules-based default: each contract season is worth his market salary at his projected
 * rating, minus (most of) his cap hit, weighted by how much the team cares about that season. Young
 * players add their restricted years after the deal. A big contract on a fading player comes
 * out negative.
 */
export const surplusValuator: PlayerValuator = {
  value(player, team, rules) {
    const age = team.season - player.birthYear;
    const lean = team.lean ?? 0;
    const h = HORIZON[team.status];
    const now = h.now * (1 + LEAN_NOW * lean);
    const later = Math.min(0.99, h.later * (1 - LEAN_LATER * lean));
    const weight = (y: number) => (y === 0 ? now * team.seasonLeft : later ** y);
    const cost = player.contract?.capHit ?? 0;
    const years = player.contract
      ? Math.max(0, player.contract.expiresAfterSeason - team.season + 1)
      : 0;
    const worth = (y: number) =>
      salaryForOverall(rules, projectedOverall(player, age, y)) *
      (team.needs.includes(player.position) ? 1 + NEED_BONUS : 1);

    let surplus = 0;
    for (let y = 0; y < years; y++) surplus += weight(y) * (worth(y) - CAP_DOLLAR_COST * cost);
    const control = Math.max(
      0,
      Math.min(MAX_CONTROL_YEARS, rules.contracts.ufaAge - (age + years)),
    );
    for (let y = years; y < years + control; y++) {
      surplus += weight(y) * worth(y) * CONTROL_DISCOUNT;
    }

    const reasons: ValueReason[] = [];
    if (surplus < 0) reasons.push('negative_contract');
    if (years === 1 && control === 0 && team.seasonLeft < 1) reasons.push('rental');
    if (control > 0 && age <= 22) reasons.push('prospect');
    if (team.needs.includes(player.position)) reasons.push('fills_need');
    return { surplus: Math.round(surplus), reasons };
  },
};
