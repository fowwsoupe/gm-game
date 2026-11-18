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
    /** 'conference': the best teams of each conference meet in a bracket per conference, then a final. */
    seeding: 'points' | 'conference' | 'wildcard';
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
    /** The playoff cap: a team's best N skaters and goalies must fit under the upper limit. Null = no playoff cap. */
    playoffCap: { skaters: number; goalies: number } | null;
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
    /** Yearly salary of an entry-level contract. */
    elcSalary: Dollars;
    /**
     * Players younger than this when their contract ends are restricted free agents: their team
     * keeps their rights and re-signs them below market. Value counts those years.
     */
    ufaAge: number;
    /** A no-trade clause needs a player at least `ufaAge` old, and a team holds at most this many. */
    maxNoTradePerTeam: number;
    /** Most of a year's cap hit that may be paid as a signing bonus, in whole percent. */
    maxBonusPct: number;
    /**
     * Most an entry-level contract may pay in performance bonuses a year. They sit outside the
     * cap hit; earned bonuses over the cap count against next season's.
     */
    maxPerformanceBonus: Dollars;
    /**
     * Draft picks (by round) a team gives the rights team when its offer sheet signs a restricted
     * free agent away, by the sheet's cap hit: the highest tier it reaches, lowest tier first.
     * First-round picks come from consecutive drafts starting with the next one; the team must
     * own every one of them to send the sheet.
     */
    offerSheetCompensation: { minCapHit: Dollars; rounds: number[] }[];
  };

  draft: {
    rounds: number;
    /**
     * Lottery for the first round: teams that missed the playoffs, worst first, with each one's
     * chance (in %) of winning a draw. `draws` teams jump to the front of round one. Null = worst picks first.
     */
    lottery: { draws: number; odds: number[] } | null;
  };

  awards: {
    /** Players this age or younger are rookie-award eligible. */
    rookieMaxAge: number;
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

  /** League money: revenue and costs (docs/research/2026-11-owner-finance.md). */
  finance: {
    /** Seats in a team's arena, smallest to largest (each team's is derived from its id). */
    capacity: { min: number; max: number };
    /** A fan's ticket, and spend on the night (concessions, parking, merch), at a market-1 team. */
    ticketPrice: Dollars;
    gameDaySpend: Dollars;
    /** Yearly at a market-1 team. */
    sponsorship: Dollars;
    localMedia: Dollars;
    /** Yearly, the same for every team (national media, league business). */
    leagueShare: Dollars;
    /** A playoff home date: the gate's markup and the players' share (whole percent), and the league's fee. */
    playoffs: { markupPct: number; playersPct: number; feePerDate: Dollars };
    /** Arena and operations: a fixed yearly amount plus a cost per home date (x market). */
    operations: { yearly: Dollars; perHomeDate: Dollars };
    /** A head coach's salary a season and the length of his deals. */
    coach: { salary: Dollars; years: number };
  };

  /** Front-office staff (docs/research/2026-11-front-office.md). */
  frontOffice: {
    /** A department head's salary, the worst (quality 0) to the best (1), rising with quality squared. */
    salary: { min: Dollars; max: Dollars };
    /** Rating points a year the best development staff adds to a young player, the worst takes away. */
    development: { points: number };
    /** A team's read of a prospect's potential (SD, rating points), the best scouting to the worst; the public range is 4. */
    scouting: { best: number; worst: number };
    /** Injury days x (1 + days x (league average - quality)): the best medical staff shortens them. */
    medical: { days: number };
    /** Rating points the best head coach adds to every player in games, the worst takes away. */
    coaching: { points: number };
    /** Yearly chance a department head leaves, however the team did. */
    leave: number;
    /** Extra chance a good head is hired away: x his quality x the team's points % above average, in SDs. */
    poach: number;
    /** How far the owner's budget (0-1) tilts the quality of a new hire around average (0.5). */
    spend: number;
    /** Spread (SD) of a new hire's quality. */
    hireSd: number;
  };

  roster: {
    maxActive: number;
    minActive: number;
    /** Fewest players a team must carry at each position (sport-specific codes). */
    positionMin: Record<string, number>;
  };
}
