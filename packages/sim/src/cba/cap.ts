import type {
  CapCharge,
  CapIssue,
  CapSeason,
  CapSheet,
  Player,
  SeasonPhase,
  TeamId,
} from '@gm/shared';
import { pct, type Dollars, type LeagueState } from '../core';
import { contractIn } from './contracts';
import type { Ruleset } from './ruleset';

/**
 * Team-level cap rules: what a team owes each season, whether that is legal, and what a
 * buyout or a retained-salary trade would cost. Pure functions over the ruleset; the cap
 * advisor shows the issues, it never blocks a move.
 *
 * Contracts in the game pay a flat salary equal to their cap hit (no front- or back-loading
 * yet), so "remaining salary" is cap hit × remaining seasons.
 */

/**
 * Whether a payroll is legal. In the offseason a team may run over the upper limit by the
 * ruleset's overage allowance; during the season it must sit between the floor and the
 * ceiling. `'future'` (a projected season) only checks the ceiling: future floors are met by
 * signings that have not happened yet.
 */
export function capIssues(
  rules: Ruleset,
  total: Dollars,
  phase: SeasonPhase | 'future',
): CapIssue[] {
  const { upperLimit, lowerLimit, offseasonOveragePct } = rules.cap;
  if (phase === 'offseason') {
    const limit = upperLimit + pct(upperLimit, offseasonOveragePct);
    return total > limit ? [{ code: 'over_offseason_limit', over: total - limit }] : [];
  }
  if (total > upperLimit) return [{ code: 'over_cap', over: total - upperLimit }];
  if (phase !== 'future' && total < lowerLimit) {
    return [{ code: 'below_floor', short: lowerLimit - total }];
  }
  return [];
}

/**
 * A team's cap sheet from `fromSeason` for `years` seasons: every contract that runs through
 * each season, plus dead cap. `phase` is where the league is in `fromSeason`; later seasons are
 * projections at today's cap limits.
 */
export function capSheet(
  rules: Ruleset,
  input: {
    teamId: TeamId;
    players: readonly Player[];
    charges: readonly CapCharge[];
    fromSeason: number;
    years: number;
    phase: SeasonPhase;
  },
): CapSheet {
  const signed = input.players.filter((p) => p.teamId === input.teamId);
  const seasons: CapSeason[] = [];
  for (let season = input.fromSeason; season < input.fromSeason + input.years; season++) {
    const onBooks = signed
      .flatMap((p) => {
        const c = contractIn(p, season);
        return c ? [{ id: p.id, c }] : [];
      })
      .sort((a, b) => b.c.capHit - a.c.capHit || a.id.localeCompare(b.id));
    const committed = onBooks.reduce((sum, x) => sum + x.c.capHit, 0);
    const deadCap = input.charges
      .filter((c) => c.teamId === input.teamId && c.season === season)
      .reduce((sum, c) => sum + c.amount, 0);
    const total = committed + deadCap;
    seasons.push({
      season,
      upperLimit: rules.cap.upperLimit,
      lowerLimit: rules.cap.lowerLimit,
      contracts: onBooks.map((x) => ({
        playerId: x.id,
        capHit: x.c.capHit,
        expiresAfterSeason: x.c.expiresAfterSeason,
      })),
      committed,
      deadCap,
      total,
      space: rules.cap.upperLimit - total,
      issues: capIssues(rules, total, season === input.fromSeason ? input.phase : 'future'),
    });
  }
  return { teamId: input.teamId, seasons };
}

/**
 * Dead cap from buying out `player` after `season` ends. The team pays a share of the
 * remaining salary (a smaller share for young players), spread over `termMultiplier` times
 * the remaining seasons, starting next season. With flat salaries the cap charge each of those
 * seasons equals the payment. Empty if the contract ends with `season`.
 */
export function buyoutCharges(
  rules: Ruleset,
  input: { teamId: TeamId; player: Player; season: number },
): CapCharge[] {
  const { contract } = input.player;
  const remaining = contract ? contract.expiresAfterSeason - input.season : 0;
  if (!contract || remaining <= 0) return [];
  const age = input.season - input.player.birthYear;
  const { shareOwedUnderAge, shareOwedOtherwise, termMultiplier } = rules.buyouts;
  const share = age < shareOwedUnderAge.age ? shareOwedUnderAge.share : shareOwedOtherwise;
  // A signing bonus was paid up front: only the salary part is owed on a buyout.
  const owed = Math.round(share * (contract.capHit - (contract.bonus ?? 0)) * remaining);
  const spread = Math.max(1, Math.round(termMultiplier * remaining));
  const each = Math.floor(owed / spread);
  return Array.from({ length: spread }, (_, i) => ({
    teamId: input.teamId,
    playerId: input.player.id,
    kind: 'buyout' as const,
    season: input.season + 1 + i,
    // The last season takes the rounding remainder, so the charges add up to exactly `owed`.
    amount: i === spread - 1 ? owed - each * (spread - 1) : each,
  }));
}

export type RetentionIssue =
  | { code: 'retention_too_high'; max: number }
  | { code: 'too_many_retained'; max: number }
  | { code: 'retained_too_recently'; days: number };

/**
 * Whether a team may keep `retainPct` of a contract's cap hit when trading the player.
 * `teamRetainedCount`: contracts the team already retains on. `daysSinceRetained`: days since
 * this same contract was last traded with retention (null if never), for the double-retention ban.
 * For trades (M6); the rules live here so every caller checks them the same way.
 */
export function retentionIssues(
  rules: Ruleset,
  input: { retainPct: number; teamRetainedCount: number; daysSinceRetained: number | null },
): RetentionIssue[] {
  const { maxRetentionPct, maxRetainedContracts, doubleRetentionCooldownDays } = rules.trades;
  const issues: RetentionIssue[] = [];
  if (input.retainPct > maxRetentionPct) {
    issues.push({ code: 'retention_too_high', max: maxRetentionPct });
  }
  if (input.teamRetainedCount >= maxRetainedContracts) {
    issues.push({ code: 'too_many_retained', max: maxRetainedContracts });
  }
  if (
    input.daysSinceRetained !== null &&
    doubleRetentionCooldownDays > 0 &&
    input.daysSinceRetained < doubleRetentionCooldownDays
  ) {
    issues.push({ code: 'retained_too_recently', days: doubleRetentionCooldownDays });
  }
  return issues;
}

/**
 * The cap year signings and trades are judged for: next season once the champion is crowned
 * (expiring deals are then off the books), else the current one.
 */
export const capYearOf = (state: LeagueState) => state.date.season + (state.championTeamId ? 1 : 0);

/** What a team's cap counts in the cap year: contracts that run through it, plus dead cap. */
export function teamCapTotal(
  state: LeagueState,
  teamId: TeamId,
  players: readonly Player[] = Object.values(state.players),
): Dollars {
  const season = capYearOf(state);
  const committed = players
    .filter((p) => p.teamId === teamId)
    .reduce((sum, p) => sum + (contractIn(p, season)?.capHit ?? 0), 0);
  return committed + deadCap(state, teamId, season);
}

/** Dead cap (buyouts, retained salary) a team carries in `season`. */
export const deadCap = (state: LeagueState, teamId: TeamId, season: number): Dollars =>
  state.capCharges
    .filter((c) => c.teamId === teamId && c.season === season)
    .reduce((sum, c) => sum + c.amount, 0);

/** Cap issues for a total in the cap year: the offseason allowance once the season is over, else the ceiling only. */
export const capYearIssues = (rules: Ruleset, state: LeagueState, total: Dollars) =>
  capIssues(rules, total, state.championTeamId ? 'offseason' : 'future');
