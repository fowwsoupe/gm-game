import { pct, type Dollars } from '../core';
import type { Ruleset } from './ruleset';

/**
 * Pure contract rules. Every feature that creates or changes a contract (free agency,
 * extensions, trades, the editor) validates through here, so rules live in one place.
 */

export interface ContractTerms {
  /** Salary for each season of the deal, in order. */
  salaries: Dollars[];
  signingAge: number;
  /** True if re-signing with the player's current team. */
  isResign: boolean;
}

export type ContractIssue =
  | { code: 'too_long'; max: number }
  | { code: 'below_minimum'; season: number; min: Dollars }
  | { code: 'above_maximum'; max: Dollars }
  | { code: 'empty' };

export const averageAnnualValue = (salaries: Dollars[]): Dollars =>
  salaries.length === 0 ? 0 : Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length);

export const maxPlayerCapHit = (rules: Ruleset): Dollars =>
  pct(rules.cap.upperLimit, rules.cap.maxPlayerPctOfUpper);

export function validateContract(rules: Ruleset, terms: ContractTerms): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (terms.salaries.length === 0) return [{ code: 'empty' }];
  const maxYears = terms.isResign
    ? rules.contracts.maxYearsResign
    : rules.contracts.maxYearsNewTeam;
  if (terms.salaries.length > maxYears) issues.push({ code: 'too_long', max: maxYears });
  terms.salaries.forEach((s, i) => {
    if (s < rules.cap.minSalary)
      issues.push({ code: 'below_minimum', season: i, min: rules.cap.minSalary });
  });
  if (averageAnnualValue(terms.salaries) > maxPlayerCapHit(rules)) {
    issues.push({ code: 'above_maximum', max: maxPlayerCapHit(rules) });
  }
  // TODO(feature): year-to-year variance limits, front-loading rules, bonuses, 35+ rules.
  return issues;
}

export function elcYears(rules: Ruleset, signingAge: number): number | null {
  const row = rules.contracts.elcYearsByAge.find(
    (r) => signingAge >= r.minAge && signingAge <= r.maxAge,
  );
  return row ? row.years : null;
}
