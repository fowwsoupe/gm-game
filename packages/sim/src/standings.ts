import type { GameResult, StandingsRow, TeamId } from '@gm/shared';

/** NHL points: 2 for a win, 1 for an overtime/shootout loss. */
export function computeStandings(
  teamIds: readonly TeamId[],
  results: readonly GameResult[],
): StandingsRow[] {
  const rows = new Map<TeamId, StandingsRow>(
    teamIds.map((id) => [id, { teamId: id, gp: 0, w: 0, l: 0, otl: 0, pts: 0, gf: 0, ga: 0 }]),
  );
  for (const g of results) {
    const home = rows.get(g.homeTeamId);
    const away = rows.get(g.awayTeamId);
    if (!home || !away) continue;
    const homeWon = g.homeGoals > g.awayGoals;
    const [winner, loser] = homeWon ? [home, away] : [away, home];
    home.gp++;
    away.gp++;
    home.gf += g.homeGoals;
    home.ga += g.awayGoals;
    away.gf += g.awayGoals;
    away.ga += g.homeGoals;
    winner.w++;
    winner.pts += 2;
    if (g.overtime) {
      loser.otl++;
      loser.pts += 1;
    } else {
      loser.l++;
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.pts - a.pts || b.w - a.w || b.gf - b.ga - (a.gf - a.ga),
  );
}
