import type { Player } from '@gm/shared';

/** Seasons together after which a player is fully part of the group. */
export const CHEMISTRY_FULL_SEASONS = 3;

/**
 * Team chemistry from time together: each player's seasons with the team (capped), averaged
 * over the roster, as 0–1. A player here since before the league began counts as settled.
 * Visible on the lines screen; trades and signings lower it, time raises it.
 * TODO(feature): linemates' shared ice time, fitting builds, personalities and leaders.
 */
export function chemistry(
  players: readonly Player[],
  season: number,
): { value: number; seasons: number } {
  if (players.length === 0) return { value: 0.5, seasons: 0 };
  const tenure = players.map((p) =>
    p.joined === undefined
      ? CHEMISTRY_FULL_SEASONS
      : Math.min(CHEMISTRY_FULL_SEASONS, Math.max(0, season - p.joined)),
  );
  const seasons = tenure.reduce((a, b) => a + b, 0) / tenure.length;
  return { value: seasons / CHEMISTRY_FULL_SEASONS, seasons };
}
