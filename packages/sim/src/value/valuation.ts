import type { Player, TeamStatus } from '@gm/shared';
import type { Dollars } from '../core';
import { contractIn, type Ruleset } from '../cba';
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
  /** Share of that regular season still to play, 0–1 (1 before it starts): rentals lose value as it runs out. */
  seasonLeft: number;
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
 * How much a team cares about this season (`now`) versus each later one (`later` per year), and
 * the share of this season that is the playoff run (`playoffs`): it is still ahead at the trade
 * deadline, so a contender's rental keeps most of its worth while a seller's runs out with the
 * regular season. Contenders spend the future on today; rebuilders the other way round.
 * Game numbers from docs/research/2026-11-camp-deadline.md, tuned in the lab.
 */
const HORIZON: Record<TeamStatus, { now: number; later: number; playoffs: number }> = {
  contender: { now: 1.25, later: 0.6, playoffs: 0.5 },
  buyer: { now: 1.1, later: 0.75, playoffs: 0.3 },
  bubble: { now: 1, later: 0.85, playoffs: 0.1 },
  seller: { now: 0.7, later: 0.9, playoffs: 0 },
  rebuilder: { now: 0.45, later: 0.95, playoffs: 0 },
  crisis: { now: 0.6, later: 0.9, playoffs: 0 },
};

/** How far a GM's lean moves this season's weight, and each later season's. */
const LEAN_NOW = 0.2;
const LEAN_LATER = 0.06;

/**
 * A restricted player (younger than the UFA age) re-signs at this share of his market ask: his
 * team holds his rights. This is where cheap young cores come from.
 */
export const RFA_DISCOUNT = 0.75;
/** After his deal a restricted player re-signs this far below his worth. */
const CONTROL_DISCOUNT = 1 - RFA_DISCOUNT;
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
 * Expected overall `years` from now. A rough sport-neutral curve (young players close most of the
 * gap to their potential each year to 24, then fade a little more each year); the development
 * model owns the real one (hockey: sports/hockey/aging.ts). Out of step with it, AI GMs paid for
 * a decline they did not see coming and dynasties ran longer (balance lab seed 1: the top
 * team's titles 5.7 against 4.6 in step).
 */
function projectedOverall(player: Player, age: number, years: number): number {
  let rating = overall(player);
  for (let y = 1; y <= years; y++) {
    const a = age + y;
    if (a <= 24) rating += Math.max(0, player.potential - rating) * 0.7;
    else rating -= 0.3 + 0.2 * (a - 25);
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
    const left = h.playoffs + (1 - h.playoffs) * team.seasonLeft;
    const weight = (y: number) => (y === 0 ? now * left : later ** y);
    // An extension signed but not started yet counts: it is his deal for those seasons.
    const deal = player.extension ?? player.contract;
    const years = deal ? Math.max(0, deal.expiresAfterSeason - team.season + 1) : 0;
    const cost = (y: number) => contractIn(player, team.season + y)?.capHit ?? 0;
    const worth = (y: number) =>
      salaryForOverall(rules, projectedOverall(player, age, y)) *
      (team.needs.includes(player.position) ? 1 + NEED_BONUS : 1);

    let surplus = 0;
    for (let y = 0; y < years; y++) surplus += weight(y) * (worth(y) - CAP_DOLLAR_COST * cost(y));
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
