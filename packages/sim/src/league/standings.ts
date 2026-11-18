import type { GameResult, StandingsRow, TeamId } from '@gm/shared';
import type { LeagueState } from '../core';
import type { Ruleset } from '../cba';

/** Standings order: points, then wins, then goal difference, then team id (a total order). */
export const byStanding = (a: StandingsRow, b: StandingsRow) =>
  b.pts - a.pts || b.w - a.w || b.gf - b.ga - (a.gf - a.ga) || a.teamId.localeCompare(b.teamId);

/** Points per result come from the ruleset (`ruleset.season.points`). */
export function computeStandings(
  teamIds: readonly TeamId[],
  results: Iterable<GameResult>,
  points: { win: number; overtimeLoss: number },
): StandingsRow[] {
  const rows = new Map<TeamId, StandingsRow>(
    teamIds.map((id) => [id, { teamId: id, gp: 0, w: 0, l: 0, otl: 0, pts: 0, gf: 0, ga: 0 }]),
  );
  for (const g of results) {
    if (g.playoffSeriesId) continue;
    const home = rows.get(g.homeTeamId);
    const away = rows.get(g.awayTeamId);
    if (!home || !away) continue;
    const homeWon = g.homeScore > g.awayScore;
    const [winner, loser] = homeWon ? [home, away] : [away, home];
    home.gp++;
    away.gp++;
    home.gf += g.homeScore;
    home.ga += g.awayScore;
    away.gf += g.awayScore;
    away.ga += g.homeScore;
    winner.w++;
    winner.pts += points.win;
    if (g.overtime) {
      loser.otl++;
      loser.pts += points.overtimeLoss;
    } else {
      loser.l++;
    }
  }
  return [...rows.values()].sort(byStanding);
}

/** This season's standings of every team in the league. */
export const leagueStandings = (state: LeagueState, ruleset: Ruleset): StandingsRow[] =>
  computeStandings(
    Object.keys(state.teams) as TeamId[],
    Object.values(state.results),
    ruleset.season.points,
  );

/** Worst team first, from this season's standings. */
export const worstFirst = (state: LeagueState, ruleset: Ruleset): TeamId[] =>
  leagueStandings(state, ruleset)
    .map((row) => row.teamId)
    .reverse();
