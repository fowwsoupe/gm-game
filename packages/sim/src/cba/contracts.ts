import type { Contract, Player, Prospect } from '@gm/shared';
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
  /** A no-trade clause on the deal, and how many the team already holds. */
  noTrade?: { held: number };
  /** Share (whole percent) of each year's cap hit paid as a signing bonus. */
  bonusPct?: number;
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
  | { code: 'no_trade_age'; min: number }
  | { code: 'no_trade_limit'; max: number }
  | { code: 'bonus_too_high'; max: number }
  | { code: 'empty' };

const averageAnnualValue = (salaries: Dollars[]): Dollars =>
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
  if (
    terms.bonusPct !== undefined &&
    (terms.bonusPct < 0 || terms.bonusPct > rules.contracts.maxBonusPct)
  ) {
    issues.push({ code: 'bonus_too_high', max: rules.contracts.maxBonusPct });
  }
  if (terms.noTrade) {
    if (terms.elc || terms.signingAge < rules.contracts.ufaAge)
      issues.push({ code: 'no_trade_age', min: rules.contracts.ufaAge });
    if (terms.noTrade.held >= rules.contracts.maxNoTradePerTeam)
      issues.push({ code: 'no_trade_limit', max: rules.contracts.maxNoTradePerTeam });
  }
  // Not modelled yet, so they cannot be broken: 35+ contracts and the ELC slide (rules still
  // to verify, see ruleset-nhl-2026.ts).
  return issues;
}

export function elcYears(rules: Ruleset, signingAge: number): number | null {
  const row = rules.contracts.elcYearsByAge.find(
    (r) => signingAge >= r.minAge && signingAge <= r.maxAge,
  );
  return row ? row.years : null;
}

/**
 * The entry deal a prospect signs for `season` (first-rounders with the most performance bonus
 * the rules allow), or null if his age has none. Trades value a prospect on it.
 */
export function prospectDeal(rules: Ruleset, pr: Prospect, season: number): Contract | null {
  const years = elcYears(rules, season - pr.player.birthYear);
  if (years === null) return null;
  return {
    capHit: rules.contracts.elcSalary,
    expiresAfterSeason: season + years - 1,
    ...(pr.round === 1 && { perfBonus: rules.contracts.maxPerformanceBonus }),
  };
}

/** Summers a team holds the rights of a pick drafted at `draftAge` (0: none). */
export const rightsYears = (rules: Ruleset, draftAge: number): number =>
  rules.draft.rightsYears.find((r) => draftAge <= r.maxAge)?.years ?? 0;
