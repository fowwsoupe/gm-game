import type { TeamStatus } from '@gm/shared';
import { pct, type Dollars } from '../core';
import type { Ruleset } from '../cba';

/** Surplus of the first overall pick, as a share of the cap: a cheap entry deal on a future star. */
const TOP_PICK_PCT_OF_CAP = 10;
/** Each full round further down the draft, a pick is worth this share (last of round one ≈ 15% of first). */
const PER_ROUND = 0.15;
/** A pick a year further away is worth this much of the same pick now. */
const PER_YEAR = 0.85;
/** Rebuilders want picks, contenders want players now. */
const STATUS_WEIGHT: Record<TeamStatus, number> = {
  contender: 0.7,
  buyer: 0.85,
  bubble: 1,
  seller: 1.15,
  rebuilder: 1.3,
  crisis: 1.2,
};

/**
 * What a draft pick is worth to a team, in surplus dollars (comparable with player values).
 * One curve over the whole draft order (`slot` 1 = first overall in its round, of `teams`), so
 * the last first-rounder is still worth more than the first second-rounder; then by how many
 * drafts away it is and how much the team cares about the future.
 * TODO(M6, Azmi): a curve calibrated on real pick trades and draft outcomes.
 */
export function pickValue(
  rules: Ruleset,
  pick: { slot: number; teams: number; round: number; yearsAway: number },
  status: TeamStatus,
): Dollars {
  const top = pct(rules.cap.upperLimit, TOP_PICK_PCT_OF_CAP);
  const overall = (pick.round - 1) * pick.teams + pick.slot;
  const roundsDown = pick.teams > 1 ? (overall - 1) / (pick.teams - 1) : 0;
  return Math.round(
    top * PER_ROUND ** roundsDown * PER_YEAR ** pick.yearsAway * STATUS_WEIGHT[status],
  );
}
