/**
 * CBA & cap engine (shared by all sports): the Ruleset shape, plus pure rule checks.
 * Each sport ships its own default ruleset (hockey: sports/hockey/ruleset-nhl-2026.ts).
 * Owns: rulesets, cap math, contract validity. Never touches UI or storage.
 */
export type { Ruleset } from './ruleset';
export {
  validateContract,
  payroll,
  averageAnnualValue,
  maxPlayerCapHit,
  elcYears,
  type ContractTerms,
  type ContractIssue,
} from './contracts';
