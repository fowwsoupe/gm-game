import type { GameId, TeamId } from '@gm/shared';
import type { Rng, ScheduledGame } from '../core';

/**
 * Round-robin schedule (circle method), repeated until each team has ~gamesPerTeam games,
 * alternating home/away. One round per game day.
 *
 * TODO(feature): real league structure: divisions, conferences, back-to-backs, travel, breaks.
 */
export function roundRobinSchedule(
  season: number,
  teamIds: readonly TeamId[],
  gamesPerTeam: number,
  rng: Rng,
): ScheduledGame[] {
  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push('BYE' as TeamId);
  const n = ids.length;
  const roundsPerCycle = n - 1;
  // Every team plays once per round (even team count), so rounds = games per team.
  const rounds = gamesPerTeam;

  // Shuffle so team order in the input doesn't decide the schedule.
  for (let i = ids.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }

  const games: ScheduledGame[] = [];
  const rot = [...ids];
  for (let r = 0; r < rounds; r++) {
    const cycle = Math.floor(r / roundsPerCycle);
    for (let i = 0; i < n / 2; i++) {
      const a = rot[i]!;
      const b = rot[n - 1 - i]!;
      if (a === 'BYE' || b === 'BYE') continue;
      const flip = (cycle + r + i) % 2 === 1;
      games.push({
        id: `g${season}_${games.length}` as GameId,
        date: { season, day: r },
        homeTeamId: flip ? b : a,
        awayTeamId: flip ? a : b,
      });
    }
    rot.splice(1, 0, rot.pop()!);
  }
  return games;
}
