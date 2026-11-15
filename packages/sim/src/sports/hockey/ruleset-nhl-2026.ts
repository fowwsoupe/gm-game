import { dollars } from '../../core';
import type { Ruleset } from '../../cba';

/**
 * Default ruleset, modelled on the real league for the 2026-27 season.
 * Values and sources: docs/research/2026-11-sports-gm-research.md (rules table).
 * Sources: league / NHLPA announcement of 2026-27 payroll range (upper $104M, lower $76.9M,
 * max player salary 20% of upper) and the 2025 CBA memorandum (84 games, playoff cap,
 * shorter max terms, double-retention limits).
 *
 * League minimum: $850K (26-27), $900K (27-28), $950K (28-29), $1M (29-30).
 * TODO(verify against PuckPedia/CBA): ELC slide, arbitration, 35+ rules, retention limits,
 * offseason overage, roster and 50-contract limits; exact calendar day counts.
 */
export const NHL_2026: Ruleset = {
  id: 'nhl-2026',
  sport: 'nhl',
  name: 'Modern rules (2026-27)',
  season: {
    gamesPerTeam: 84,
    calendar: { preseasonDays: 21, regularSeasonDays: 190, tradeDeadlineDay: 140, playoffDays: 62 },
    points: { win: 2, overtimeLoss: 1 },
  },
  playoffs: {
    teamsQualifying: 16,
    seriesLength: 7,
    seeding: 'points',
    homeIcePattern: [0, 0, 1, 1, 0, 1, 0],
  },
  cap: {
    upperLimit: dollars(104),
    lowerLimit: dollars(76.9),
    maxPlayerPctOfUpper: 20,
    minSalary: dollars(0.85),
    offseasonOveragePct: 10,
    playoffCap: true,
  },
  contracts: {
    maxYearsResign: 7,
    maxYearsNewTeam: 6,
    maxYearToYearChangePctOfFirstYear: 20,
    minYearPctOfHighestYear: 71,
    elcYearsByAge: [
      { minAge: 18, maxAge: 21, years: 3 },
      { minAge: 22, maxAge: 23, years: 2 },
      { minAge: 24, maxAge: 24, years: 1 },
    ],
  },
  trades: {
    maxRetentionPct: 50,
    maxRetainedContracts: 3,
    doubleRetentionCooldownDays: 75,
  },
  buyouts: {
    shareOwedUnderAge: { age: 26, share: 1 / 3 },
    shareOwedOtherwise: 2 / 3,
    termMultiplier: 2,
  },
  roster: { maxActive: 23, minActive: 20 },
};

/** The default 16-team fictional league sends its top eight to the playoffs. */
export const FICTIONAL_2026: Ruleset = {
  ...NHL_2026,
  id: 'fictional-2026',
  name: 'Fictional league rules (2026-27)',
  playoffs: { ...NHL_2026.playoffs, teamsQualifying: 8 },
};
