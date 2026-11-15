import { isGoalie, type Player, type PlayerId, type StandingsRow } from '@gm/shared';
import { overall } from '../../players';
import type { SportModule } from '../sport';

/**
 * Hockey award formulas (our own names; keys map to translated names in the UI):
 *   mvp         best player: rating plus how well his team did (points share)
 *   topGoalie   a team's best goalie: rating plus how few goals his team allowed
 *   topDefender best D: rating plus how few goals his team allowed
 *   topRookie   best rating among rookie-aged players
 * Player stats don't exist yet (box scores are M2), so team results stand in for them.
 * TODO(M2): switch to real points, save percentage and plus-minus once games have box scores.
 */
const TEAM_WEIGHT = 10;

export const pickAwards: SportModule['pickAwards'] = ({ season, rules, players, standings }) => {
  const rows = new Map<string, StandingsRow>(standings.map((r) => [r.teamId, r]));
  const maxPts = Math.max(1, ...standings.map((r) => r.pts));
  const gas = standings.map((r) => r.ga);
  const minGa = Math.min(...gas);
  const spreadGa = Math.max(1, Math.max(...gas) - minGa);
  const attack = (p: Player) => (rows.get(p.teamId ?? '')?.pts ?? 0) / maxPts;
  const defence = (p: Player) => 1 - ((rows.get(p.teamId ?? '')?.ga ?? minGa) - minGa) / spreadGa;

  const rostered = players.filter((p) => p.teamId !== null && rows.has(p.teamId));
  // Only a team's number one goalie can win the goalie award.
  const starters = new Map<string, Player>();
  for (const p of rostered.filter((p) => isGoalie(p.position))) {
    const best = starters.get(p.teamId!);
    if (!best || overall(p) > overall(best)) starters.set(p.teamId!, p);
  }

  const best = (pool: readonly Player[], score: (p: Player) => number): PlayerId | null => {
    let winner: Player | null = null;
    let top = -Infinity;
    for (const p of pool) {
      const s = score(p);
      if (s > top || (s === top && winner && p.id < winner.id)) [winner, top] = [p, s];
    }
    return winner?.id ?? null;
  };

  const winners: [string, PlayerId | null][] = [
    ['mvp', best(rostered, (p) => overall(p) + TEAM_WEIGHT * attack(p))],
    ['topGoalie', best([...starters.values()], (p) => overall(p) + TEAM_WEIGHT * defence(p))],
    [
      'topDefender',
      best(
        rostered.filter((p) => p.position === 'D'),
        (p) => overall(p) + TEAM_WEIGHT * defence(p),
      ),
    ],
    [
      'topRookie',
      best(
        rostered.filter((p) => season - p.birthYear <= rules.awards.rookieMaxAge),
        overall,
      ),
    ],
  ];
  return winners.flatMap(([award, playerId]) => (playerId ? [{ award, playerId }] : []));
};
