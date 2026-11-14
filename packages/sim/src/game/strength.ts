import type { Player } from '@gm/shared';

export interface TeamStrength {
  offense: number;
  defense: number;
  goaltending: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 50);

/**
 * Rules-based team strength from player ratings. Deliberately simple for now:
 * this is one of the first places an ML model (trained in /ml) can replace hand-tuned weights.
 */
export function teamStrength(players: readonly Player[]): TeamStrength {
  const skaters = players
    .filter((p) => p.position !== 'G' && p.skater)
    .map((p) => p.skater!)
    .sort((a, b) => b.shooting + b.passing - (a.shooting + a.passing));
  const top = skaters.slice(0, 18);

  const goalies = players
    .filter((p) => p.position === 'G' && p.goalie)
    .map((p) => p.goalie!)
    .sort((a, b) => b.reflexes + b.positioning - (a.reflexes + a.positioning));
  const starter = goalies[0];

  return {
    offense: avg(
      top.map((s) => s.shooting * 0.4 + s.passing * 0.3 + s.puckHandling * 0.2 + s.skating * 0.1),
    ),
    defense: avg(top.map((s) => s.defense * 0.5 + s.hockeyIq * 0.3 + s.physical * 0.2)),
    goaltending: starter
      ? starter.reflexes * 0.4 +
        starter.positioning * 0.35 +
        starter.reboundControl * 0.15 +
        starter.consistency * 0.1
      : 40,
  };
}
