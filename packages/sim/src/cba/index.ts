/**
 * CBA & cap engine (shared by all sports): the Ruleset shape, plus pure rule checks.
 * Each sport ships its own default ruleset (hockey: sports/hockey/ruleset-nhl-2026.ts).
 * Owns: rulesets, cap math, contract validity. Never touches UI or storage.
 */
export type { Ruleset } from './ruleset';
export {
  validateContract,
  contractIn,
  payroll,
  maxPlayerCapHit,
  elcYears,
  type ContractTerms,
  type ContractIssue,
} from './contracts';
export {
  capIssues,
  capSheet,
  capYearIssues,
  teamCapTotal,
  deadCap,
  buyoutCharges,
  retentionIssues,
} from './cap';
export { payBonuses } from './bonuses';
/** The cap year lives in core (the reducer needs it too); the cap engine's callers get it here. */
export { capYearOf } from '../core';
