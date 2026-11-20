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
    // docs/research/2026-11-spread-second-mechanism.md: unverified, tuned in the balance lab. The
    // part of team quality a roster does not carry into next season: widens the points % spread
    // and lowers its year-to-year r together. 4.5 since the fitted aging curves made rosters
    // last longer (r 0.58 at 3.5, 0.53-0.56 at 4.5; turnover and titles back in range).
    form: 4.5,
  },
  playoffs: {
    teamsQualifying: 16,
    seriesLength: 7,
    seeding: 'wildcard',
    homeIcePattern: [0, 0, 1, 1, 0, 1, 0],
  },
  cap: {
    upperLimit: dollars(104),
    lowerLimit: dollars(76.9),
    maxPlayerPctOfUpper: 20,
    minSalary: dollars(0.85),
    offseasonOveragePct: 10,
    playoffCap: { skaters: 18, goalies: 2 },
    // AHL burial relief for 2026-27 (Sound of Hockey, in the Sports GM research rules table).
    buriedRelief: dollars(1.225),
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
    elcSalary: dollars(1),
    ufaAge: 27,
    maxNoTradePerTeam: 16,
    // TODO(verify): the real signing-bonus limit; 50 is a placeholder like the other unverified rules.
    maxBonusPct: 50,
    // The NHL's "Schedule A" entry-level bonus limit, $850,000 a year.
    maxPerformanceBonus: dollars(0.85),
    // The NHL's offer-sheet table (2025-26 tiers scaled to this cap), third-rounders dropped
    // because this draft has two rounds. TODO(verify): the tiers move with the league's average salary.
    offerSheetCompensation: [
      { minCapHit: dollars(2.55), rounds: [2] },
      { minCapHit: dollars(5.09), rounds: [1] },
      { minCapHit: dollars(7.64), rounds: [1, 2] },
      { minCapHit: dollars(10.19), rounds: [1, 1, 2] },
      { minCapHit: dollars(12.74), rounds: [1, 1, 1, 1] },
    ],
  },
  // The real draft has 7 rounds. Picks now wait unsigned in the prospect pool, but more rounds
  // change the talent supply and the pick value curve: a balance job of its own
  // (docs/research/2026-11-minor-leagues.md).
  draft: {
    rounds: 2,
    // Odds for the 16 non-playoff teams, worst first (the league's 2021 lottery). Two draws, so a team
    // can fall at most two spots.
    lottery: {
      draws: 2,
      odds: [18.5, 13.5, 11.5, 9.5, 8.5, 7.5, 6.5, 6, 5, 3.5, 3, 2.5, 2, 1.5, 0.5, 0.5],
    },
    // From 2027: four years for a pick drafted at 18, three at 19 or older (Sound of Hockey, in the
    // Sports GM research rules table).
    rightsYears: [
      { maxAge: 18, years: 4 },
      { maxAge: 99, years: 3 },
    ],
    // TODO(verify): the CHL-NHL agreement (general knowledge, unsourced).
    juniorMaxAge: 20,
  },
  // A rookie: his first season, 26 or under (the real limit, general knowledge). Players in the
  // league from before the prospect pool keep the old rule: 20 or under.
  awards: { rookieMaxAge: 26, rookieMaxAgeNoDebut: 20 },
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
  // docs/research/2026-11-owner-finance.md ("The model"): 2024-25 numbers scaled by the cap ratio
  // (104 / 88). Fans and prices from its benchmark table; operations tuned in the balance lab.
  finance: {
    capacity: { min: 16_000, max: 21_105 }, // NHL 2024-25: the largest crowd, every home date
    ticketPrice: 160, // blended a fan, premium seats in (44% ticket share over attendance)
    gameDaySpend: 48, // 12% game-day share
    sponsorship: dollars(59), // SponsorUnited, about $48M a team
    localMedia: dollars(10), // no clean public number: the remainder, tuned in the lab
    leagueShare: dollars(59), // national media, under $1.5B league-wide
    playoffs: { markupPct: 15, playersPct: 35, feePerDate: dollars(0.5) }, // LVSportsBiz
    // Yearly was $50M with the front office inside it; its four departments now cost about $5.3M
    // on average (see frontOffice), so total costs hold.
    operations: { yearly: dollars(44.7), perHomeDate: dollars(1.9) },
    coach: { salary: dollars(2.95), years: 3 }, // ESPN 2024: about $2.5M, usually three-year deals
    relocationFanLoss: 15, // game design: a move costs fans, a market change is a fresh start
  },
  // The 2021 Seattle draft: 11 protected a team (7 F, 3 D, 1 G), one player from each of the others.
  expansion: { maxTeams: 32, protect: 11, picks: 18, maxLossPerTeam: 2 },
  // docs/research/2026-11-front-office.md: no public source; unverified, tuned in the lab.
  frontOffice: {
    salary: { min: dollars(0.5), max: dollars(3) },
    // Tuned in the balance lab against the long-run brief's three NHL benchmarks (spread, year-to-year
    // r, playoff turnover): a strong edge that moves on with its people.
    // Development is the lever for spread; past 3 the edge lives on in its players and playoff
    // turnover falls under the NHL's. The coach's edge moves on with him.
    development: { points: 3 }, // was ORG_DEVELOPMENT 2, from GM skill
    scouting: { best: 2, worst: 6 }, // the GM misread on prospects was 1-6
    medical: { days: 0.4 },
    analytics: { best: 1, worst: 6 }, // like the AI GMs' misread, 1-6
    coaching: { points: 1.5 }, // at 2 a coach's defence made goalie save % too repeatable
    leave: 0.3,
    poach: 0.6,
    spend: 0.6,
    hireSd: 0.2,
    interim: 0.3, // the brief's interim quality
  },
  // docs/research/2026-11-free-agency-bidding.md: the brief's numbers, unverified game numbers.
  freeAgency: {
    days: 2,
    raiseStep: 0.05,
    maxPremium: 1.2,
    line: 70,
    lineSwing: 5,
    markup: 6,
    patience: 4,
    lowball: 15,
  },
  training: { points: 2 }, // the brief's start, a game number for the lab
  international: { every: 4 },
  roster: {
    maxActive: 23,
    minActive: 20,
    positionMin: { C: 4, LW: 4, RW: 4, D: 6, G: 2 },
  },
};

/** The default 16-team fictional league sends its top eight to the playoffs. */
export const FICTIONAL_2026: Ruleset = {
  ...NHL_2026,
  id: 'fictional-2026',
  name: 'Fictional league rules (2026-27)',
  playoffs: { ...NHL_2026.playoffs, teamsQualifying: 8 },
};
