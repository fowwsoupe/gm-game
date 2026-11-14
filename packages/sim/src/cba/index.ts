/**
 * CBA & cap engine: the league's rules as data, plus pure rule checks.
 * Owns: rulesets, cap math, contract validity. Never touches UI or storage.
 */
export type { Ruleset } from './ruleset';
export { NHL_2026 } from './rulesets/nhl-2026';
export {
  validateContract,
  averageAnnualValue,
  maxPlayerCapHit,
  elcYears,
  type ContractTerms,
  type ContractIssue,
} from './contracts';
