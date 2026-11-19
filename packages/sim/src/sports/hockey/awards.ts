import type { GameResult, Player, PlayerId, TeamId } from '@gm/shared';
import type { SportModule } from '../sport';
import { hockeySeasonStats } from './stats';

/**
 * Hockey award formulas (our own names; keys map to translated names in the UI), from box scores:
 *   mvp         most points; goals, then plus-minus, break ties
 *   topGoalie   best save percentage among goalies with a quarter of the busiest goalie's games
 *   topDefender defenceman with the most points plus half his plus-minus
 *   topRookie   player in his first main-league season (or, with no debut on record, rookie
 *               aged) with the most points
 *   playoffMvp  the champion's best playoff performer, skater or goalie, scored in goals: a
 *               skater's goals plus half his assists; a goalie's goals saved above the league's
 *               playoff save % (with at least a quarter of his team's playoff games), weighted
 *               by PLAYOFF_GOALIE_WEIGHT
 * TODO(feature): vote-style scoring (team success, narrative), Selke-type defensive forward award.
 */
export const pickAwards: SportModule['pickAwards'] = ({
  season,
  rules,
  players,
  results,
  playoffResults,
  championTeamId,
}) => {
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
        rostered.filter((p) =>
          p.debut === undefined
            ? season - p.birthYear <= rules.awards.rookieMaxAgeNoDebut
            : p.debut === season && season - p.birthYear <= rules.awards.rookieMaxAge,
        ),
        pointsOf,
      ),
    ],
  ];
  if (championTeamId)
    winners.push(['playoffMvp', playoffMvp(players, playoffResults, championTeamId, best)]);
  return winners.flatMap(([award, playerId]) => (playerId ? [{ award, playerId }] : []));
};

/** A goalie legend lends his name to the goalie award, a defenceman to the defence award, a forward to the MVP. */
export const hockeyLegendAward: SportModule['legendAward'] = (position) =>
  position === 'G' ? 'topGoalie' : position === 'D' ? 'topDefender' : 'mvp';

/**
 * A playoff goal saved counts this much more than a goal created, so a goalie wins the Playoff MVP
 * about as often as in the NHL's playoff MVP history (16 of ~59 since 1965, ~27%). At 1.0 goalies
 * won 6% of simulated seasons; 1.5 gave 23% and 2.0 gave 35% (200 seasons).
 */
const PLAYOFF_GOALIE_WEIGHT = 1.6;

function playoffMvp(
  players: readonly Player[],
  results: readonly GameResult[],
  championTeamId: TeamId,
  best: (pool: readonly Player[], score: (p: Player) => number) => PlayerId | null,
): PlayerId | null {
  const { skaters, goalies } = hockeySeasonStats(results);
  let shots = 0;
  let saves = 0;
  for (const g of goalies.values()) [shots, saves] = [shots + g.shotsAgainst, saves + g.saves];
  const leagueSv = shots > 0 ? saves / shots : 0;
  const teamGames = results.filter(
    (g) => g.homeTeamId === championTeamId || g.awayTeamId === championTeamId,
  ).length;
  const champs = players.filter((p) => p.teamId === championTeamId);
  return best(champs, (p) => {
    const s = skaters.get(p.id);
    if (s) return s.goals + s.assists / 2;
    const g = goalies.get(p.id);
    if (g && g.gp >= teamGames / 4) {
      return PLAYOFF_GOALIE_WEIGHT * g.shotsAgainst * (g.saves / g.shotsAgainst - leagueSv);
    }
    return -Infinity;
  });
}
