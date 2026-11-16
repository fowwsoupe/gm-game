import type { Contract, Player } from '@gm/shared';
import { pct, type Dollars } from '../core';
import type { Ruleset } from './ruleset';

/**
 * Pure contract rules. Every feature that creates or changes a contract (free agency,
 * extensions, trades, the editor) validates through here, so rules live in one place.
 */

/** Total cap hit of a group of players (a roster, or the players a playoff lineup would dress). */
export const payroll = (players: readonly Player[]): Dollars =>
  players.reduce((sum, p) => sum + (p.contract?.capHit ?? 0), 0);

/** The deal that pays `player` in `season`: his contract, else an extension that starts later. */
export function contractIn(player: Player, season: number): Contract | undefined {
  const { contract, extension } = player;
  if (contract && contract.expiresAfterSeason >= season) return contract;
  if (extension && extension.expiresAfterSeason >= season) return extension;
  return undefined;
}

export interface ContractTerms {
  /** Salary for each season of the deal, in order. */
  salaries: Dollars[];
  signingAge: number;
  /** True if re-signing with the player's current team. */
  isResign: boolean;
  /** An entry-level contract: its length is set by signing age and its salary is capped. */
  elc?: boolean;
}

export type ContractIssue =
  | { code: 'too_long'; max: number }
  | { code: 'below_minimum'; season: number; min: Dollars }
  | { code: 'above_maximum'; max: Dollars }
  | { code: 'variance'; season: number }
  | { code: 'year_too_low'; season: number }
  | { code: 'elc_age'; age: number }
  | { code: 'elc_length'; years: number }
  | { code: 'elc_salary'; max: Dollars }
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
  const first = terms.salaries[0]!;
  const highest = Math.max(...terms.salaries);
  const maxStep = pct(first, rules.contracts.maxYearToYearChangePctOfFirstYear);
  terms.salaries.forEach((s, i) => {
    if (i > 0 && Math.abs(s - terms.salaries[i - 1]!) > maxStep)
      issues.push({ code: 'variance', season: i });
    if (s < pct(highest, rules.contracts.minYearPctOfHighestYear))
      issues.push({ code: 'year_too_low', season: i });
  });
  if (terms.elc) {
    const years = elcYears(rules, terms.signingAge);
    if (years === null) issues.push({ code: 'elc_age', age: terms.signingAge });
    else if (terms.salaries.length !== years) issues.push({ code: 'elc_length', years });
    if (terms.salaries.some((s) => s > rules.contracts.elcSalary)) {
      issues.push({ code: 'elc_salary', max: rules.contracts.elcSalary });
    }
  }
  // Not modelled yet, so they cannot be broken: bonuses (contracts have none), 35+ contracts
  // and the ELC slide (rules still to verify, see ruleset-nhl-2026.ts).
  return issues;
}

export function elcYears(rules: Ruleset, signingAge: number): number | null {
  const row = rules.contracts.elcYearsByAge.find(
    (r) => signingAge >= r.minAge && signingAge <= r.maxAge,
  );
  return row ? row.years : null;
}
