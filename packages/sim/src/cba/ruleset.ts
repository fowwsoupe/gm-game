import type { Sport } from '@gm/shared';
import type { CalendarConfig } from '../core';
import type { Dollars } from '../core';

/**
 * The league's rules, as data. Nothing in the sim hard-codes a cap number, a contract
 * limit or a season length: it reads them from here. This is what makes the sandbox,
 * "classic rules", a future CBA (or a lockout storyline) and other sports cheap to add.
 *
 * Rulesets are versioned data files under ./rulesets. Saves store the ruleset they use.
 */
export interface Ruleset {
  id: string;
  name: string;
  /** Which sport these rules are for. */
  sport: Sport;

  season: {
    gamesPerTeam: number;
    calendar: CalendarConfig;
    /** Points for a win, and for an overtime / shootout loss. */
    points: { win: number; overtimeLoss: number };
  };

  playoffs: {
    teamsQualifying: number;
    seriesLength: number;
    seeding: 'points';
    /** 0 = higher seed at home, 1 = lower seed at home. */
    homeIcePattern: number[];
  };

  /** TODO(nba/nfl): soft cap + luxury tax (NBA) and hard cap specifics (NFL) when those sports arrive. */
  cap: {
    upperLimit: Dollars;
    lowerLimit: Dollars;
    /** Max single-player cap hit, as % of the upper limit. */
    maxPlayerPctOfUpper: number;
    minSalary: Dollars;
    /** Allowed overage in the offseason, as % of the upper limit. */
    offseasonOveragePct: number;
    /** Whether the cap also applies to the playoff roster. */
    playoffCap: boolean;
  };

  contracts: {
    maxYearsResign: number;
    maxYearsNewTeam: number;
    /** Max change between consecutive years' salary, as % of the first year's salary. */
    maxYearToYearChangePctOfFirstYear: number;
    /** No year may be below this % of the highest year. */
    minYearPctOfHighestYear: number;
    /** Entry-level contract length by signing age (inclusive ranges). */
    elcYearsByAge: { minAge: number; maxAge: number; years: number }[];
  };

  trades: {
    maxRetentionPct: number;
    maxRetainedContracts: number;
    /** Days before a contract can be retained again (0 = no restriction). */
    doubleRetentionCooldownDays: number;
  };

  buyouts: {
    /** Fraction of remaining salary owed, by age at buyout. */
    shareOwedUnderAge: { age: number; share: number };
    shareOwedOtherwise: number;
    /** Buyout cost is spread over this multiple of the remaining years. */
    termMultiplier: number;
  };

  roster: {
    maxActive: number;
    minActive: number;
  };
}
