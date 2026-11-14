import type { GameId, TeamId } from '@gm/shared';
import type { Rng } from './rng';

export interface ScheduledGame {
  id: GameId;
  day: number;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
}

/**
 * Round-robin schedule (circle method), repeated until each team has ~gamesPerTeam games,
 * alternating home/away. Placeholder until a real NHL-style schedule (divisions, back-to-backs).
 */
export function roundRobinSchedule(
  teamIds: readonly TeamId[],
  gamesPerTeam: number,
  rng: Rng,
): ScheduledGame[] {
  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push('BYE' as TeamId);
  const n = ids.length;
  const roundsPerCycle = n - 1;
  const cycles = Math.ceil(gamesPerTeam / roundsPerCycle);

  // Shuffle so team order in the input doesn't decide the schedule.
  for (let i = ids.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }

  const games: ScheduledGame[] = [];
  let day = 0;
  for (let c = 0; c < cycles; c++) {
    const rot = [...ids];
    for (let r = 0; r < roundsPerCycle; r++, day++) {
      for (let i = 0; i < n / 2; i++) {
        const a = rot[i]!;
        const b = rot[n - 1 - i]!;
        if (a === 'BYE' || b === 'BYE') continue;
        const flip = (c + r + i) % 2 === 1;
        games.push({
          id: `g${games.length}` as GameId,
          day,
          homeTeamId: flip ? b : a,
          awayTeamId: flip ? a : b,
        });
      }
      rot.splice(1, 0, rot.pop()!);
    }
  }
  return games;
}
