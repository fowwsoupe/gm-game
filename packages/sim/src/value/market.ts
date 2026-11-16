import type { Player } from '@gm/shared';
import { pct, type Dollars } from '../core';
import { maxPlayerCapHit, type Ruleset } from '../cba';
import { overall } from '../players';

/**
 * What a free agent asks for per year. A placeholder price curve: worth grows with the
 * square of how far he is above replacement level (45), scaled by the cap so it follows the
 * ruleset. Tuned so a team of average players spends about 85% of the cap.
 * TODO(M6, Azmi): contract demand model calibrated on real signings, with age and market.
 */
export function marketSalary(rules: Ruleset, player: Player): Dollars {
  const above = Math.max(0, overall(player) - 45);
  const raw = rules.cap.minSalary + pct(rules.cap.upperLimit, 0.0075) * above * above;
  const rounded = Math.round(raw / 100_000) * 100_000;
  return Math.min(maxPlayerCapHit(rules), Math.max(rules.cap.minSalary, rounded));
}

/**
 * Plug-in point for what a player asks per year. The default is `marketSalary`; a model
 * calibrated on real signings (Azmi) implements the same interface. Used by re-signing and
 * free agency; the cap rules and term limits are checked separately, so a model cannot make
 * an illegal contract.
 */
export interface ContractDemandModel {
  ask(rules: Ruleset, player: Player): Dollars;
}

export const rulesContractDemand: ContractDemandModel = { ask: marketSalary };
