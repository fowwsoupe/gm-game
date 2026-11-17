import type { Player } from '@gm/shared';
import { personalityOf } from './personality';

/** Seasons together after which a player is fully part of the group. */
export const CHEMISTRY_FULL_SEASONS = 3;

/** Leadership at or above this makes a leader; a team uses at most `MAX_LEADERS` of them. */
const LEADER = 0.75;
const MAX_LEADERS = 2;
/** Low temperament and low professionalism together make a player who wears on the room. */
const TOXIC_TEMPERAMENT = 0.2;
const TOXIC_PROFESSIONALISM = 0.3;
const MAX_TOXIC = 3;
/** How much of the team value the locker room can take away (the rest is time together). */
const LOCKER_SHARE = 0.2;

/**
 * Team chemistry, 0-1: time together (each player's seasons with the team, capped, averaged; a
 * player here since before the league began counts as settled) times a locker-room factor.
 * The locker room comes from personalities: two settled leaders make it whole, none leaves it
 * half; each player who wears on the room takes a little off. Visible on the lines screen;
 * trades and signings lower it, time raises it.
 * TODO(feature): linemates' shared ice time and fitting builds.
 */
export function chemistry(
  players: readonly Player[],
  season: number,
): { value: number; seasons: number; leaders: number } {
  if (players.length === 0) return { value: 0.5, seasons: 0, leaders: 0 };
  const tenure = players.map((p) =>
    p.joined === undefined
      ? CHEMISTRY_FULL_SEASONS
      : Math.min(CHEMISTRY_FULL_SEASONS, Math.max(0, season - p.joined)),
  );
  const seasons = tenure.reduce((a, b) => a + b, 0) / tenure.length;
  let leaders = 0;
  let toxic = 0;
  players.forEach((p, i) => {
    const { leadership, temperament, professionalism } = personalityOf(p.id);
    if (leadership >= LEADER && tenure[i]! >= 1) leaders++;
    if (temperament < TOXIC_TEMPERAMENT && professionalism < TOXIC_PROFESSIONALISM) toxic++;
  });
  const locker = Math.max(
    0,
    Math.min(1, 0.5 + 0.25 * Math.min(leaders, MAX_LEADERS) - 0.15 * Math.min(toxic, MAX_TOXIC)),
  );
  const value = (seasons / CHEMISTRY_FULL_SEASONS) * (1 - LOCKER_SHARE + LOCKER_SHARE * locker);
  return { value, seasons, leaders };
}
