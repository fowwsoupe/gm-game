import type { GameResult, StandingsRow, TeamId } from '@gm/shared';

/** Points per result come from the ruleset (default: 2 for a win, 1 for an OT/SO loss). */
export function computeStandings(
  teamIds: readonly TeamId[],
  results: Iterable<GameResult>,
  points: { win: number; overtimeLoss: number } = { win: 2, overtimeLoss: 1 },
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
    winner.pts += points.win;
    if (g.overtime) {
      loser.otl++;
      loser.pts += points.overtimeLoss;
    } else {
      loser.l++;
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.pts - a.pts || b.w - a.w || b.gf - b.ga - (a.gf - a.ga),
  );
}
