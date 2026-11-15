import type { Player, PlayerId } from '@gm/shared';
import type { SportModule } from '../sport';
import { hockeySeasonStats } from './stats';

/**
 * Hockey award formulas (our own names; keys map to translated names in the UI), from box scores:
 *   mvp         most points; goals, then plus-minus, break ties
 *   topGoalie   best save percentage among goalies with a quarter of the busiest goalie's games
 *   topDefender defenceman with the most points plus half his plus-minus
 *   topRookie   rookie-aged player with the most points
 * TODO(feature): vote-style scoring (team success, narrative), Selke-type defensive forward award.
 */
export const pickAwards: SportModule['pickAwards'] = ({ season, rules, players, results }) => {
  const { skaters, goalies } = hockeySeasonStats(results);
  const pointsOf = (p: Player) => {
    const t = skaters.get(p.id);
    return t ? t.goals + t.assists : -Infinity;
  };

  /** The player with the highest score; ties go to the lower id so the result never depends on order. */
  const best = (pool: readonly Player[], score: (p: Player) => number): PlayerId | null => {
    let winner: Player | null = null;
    let top = -Infinity;
    for (const p of pool) {
      const s = score(p);
      if (s > top || (s === top && winner && p.id < winner.id)) [winner, top] = [p, s];
    }
    return winner?.id ?? null;
  };

  const rostered = players.filter((p) => p.teamId !== null && skaters.has(p.id));
  const busiest = Math.max(0, ...[...goalies.values()].map((g) => g.gp));
  const qualified = players.filter((p) => {
    const g = goalies.get(p.id);
    return p.teamId !== null && g && g.gp >= busiest / 4 && g.shotsAgainst > 0;
  });

  const winners: [string, PlayerId | null][] = [
    [
      'mvp',
      best(rostered, (p) => {
        const t = skaters.get(p.id)!;
        return pointsOf(p) + t.goals / 1000 + t.plusMinus / 100000;
      }),
    ],
    [
      'topGoalie',
      best(qualified, (p) => goalies.get(p.id)!.saves / goalies.get(p.id)!.shotsAgainst),
    ],
    [
      'topDefender',
      best(
        rostered.filter((p) => p.position === 'D'),
        (p) => pointsOf(p) + skaters.get(p.id)!.plusMinus / 2,
      ),
    ],
    [
      'topRookie',
      best(
        rostered.filter((p) => season - p.birthYear <= rules.awards.rookieMaxAge),
        pointsOf,
      ),
    ],
  ];
  return winners.flatMap(([award, playerId]) => (playerId ? [{ award, playerId }] : []));
};
