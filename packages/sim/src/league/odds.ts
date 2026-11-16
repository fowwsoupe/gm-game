import type { GameResult, ScheduledGame, StandingsRow, Team, TeamId } from '@gm/shared';
import { Rng } from '../core';
import type { Ruleset } from '../cba';
import { computeStandings } from './standings';
import { seedPlayoffs } from './playoffs';

/**
 * Games of league-average scoring added to every team's record. Standings take about half a
 * season to say more about talent than luck (NHL), so early odds stay modest.
 */
const PRIOR_GAMES = 30;
/** Before this many games, use the defaults below for home edge and overtime share. */
const MIN_SAMPLE = 50;
const DEFAULT_HOME_WIN = 0.53;
const DEFAULT_OVERTIME = 0.2;

/**
 * How good each team is so far, 0–1: its Pythagorean win share from scoring, pulled toward
 * average early in the season. Sport-neutral; `exponent` is the sport's (hockey about 2).
 * Also the power ranking.
 */
export function teamRatings(rows: readonly StandingsRow[], exponent: number): Map<TeamId, number> {
  const gp = rows.reduce((s, r) => s + r.gp, 0);
  const perGame = gp > 0 ? rows.reduce((s, r) => s + r.gf, 0) / gp : 1;
  return new Map(
    rows.map((r) => {
      const gf = (r.gf + PRIOR_GAMES * perGame) ** exponent;
      const ga = (r.ga + PRIOR_GAMES * perGame) ** exponent;
      return [r.teamId, gf / (gf + ga)];
    }),
  );
}

/**
 * Chance each team makes the playoffs: plays the rest of the regular season `sims` times with
 * each game a weighted coin (log5 of the two ratings plus the league's home edge; overtime at
 * the league's rate gives the loser its point), then seeds the playoffs the real way.
 */
export function playoffOdds(input: {
  teams: readonly Team[];
  schedule: readonly ScheduledGame[];
  results: readonly GameResult[];
  ruleset: Ruleset;
  season: number;
  exponent: number;
  rng: Rng;
  sims: number;
  /** Play this remaining game with a set result (race night: "if we win / if we lose"). */
  fixed?: { gameId: string; homeWins: boolean };
}): Map<TeamId, number> {
  const { teams, ruleset, rng, sims } = input;
  const regular = input.results.filter((g) => !g.playoffSeriesId);
  const ids = teams.map((t) => t.id);
  const rows = computeStandings(ids, regular, ruleset.season.points);
  const rating = teamRatings(rows, input.exponent);
  const played = new Set<string>(regular.map((g) => g.id));
  const left = input.schedule.filter((g) => g.date.season === input.season && !played.has(g.id));
  const share = (n: number, fallback: number) =>
    regular.length >= MIN_SAMPLE ? n / regular.length : fallback;
  const homeEdge =
    share(regular.filter((g) => g.homeScore > g.awayScore).length, DEFAULT_HOME_WIN) - 0.5;
  const overtime = share(regular.filter((g) => g.overtime).length, DEFAULT_OVERTIME);
  const pHome = left.map((g) => {
    const a = rating.get(g.homeTeamId) ?? 0.5;
    const b = rating.get(g.awayTeamId) ?? 0.5;
    return Math.min(0.99, Math.max(0.01, (a * (1 - b)) / (a * (1 - b) + b * (1 - a)) + homeEdge));
  });

  const made = new Map<TeamId, number>(ids.map((id) => [id, 0]));
  const { win, overtimeLoss } = ruleset.season.points;
  for (let s = 0; s < (left.length ? sims : 1); s++) {
    const table = new Map(rows.map((r) => [r.teamId, { ...r }]));
    left.forEach((g, i) => {
      const roll = rng.next();
      const homeWon = g.id === input.fixed?.gameId ? input.fixed.homeWins : roll < pHome[i]!;
      const winner = table.get(homeWon ? g.homeTeamId : g.awayTeamId)!;
      const loser = table.get(homeWon ? g.awayTeamId : g.homeTeamId)!;
      winner.gp++;
      loser.gp++;
      winner.w++;
      winner.pts += win;
      if (rng.next() < overtime) {
        loser.otl++;
        loser.pts += overtimeLoss;
      } else loser.l++;
    });
    for (const series of seedPlayoffs([...table.values()], ruleset, input.season, teams)) {
      for (const id of [series.higherTeamId, series.lowerTeamId]) made.set(id, made.get(id)! + 1);
    }
  }
  const runs = left.length ? sims : 1;
  return new Map([...made].map(([id, n]) => [id, n / runs]));
}

/**
 * Race night: a team's playoff odds if it wins and if it loses its next regular-season game
 * (the same seed for both, so the difference is the game). Null with no game left.
 */
export function raceNight(
  input: Omit<Parameters<typeof playoffOdds>[0], 'fixed' | 'rng'> & {
    teamId: TeamId;
    seed: number;
  },
): { ifWin: number; ifLose: number } | null {
  const played = new Set<string>(input.results.map((g) => g.id));
  const next = input.schedule
    .filter(
      (g) =>
        g.date.season === input.season &&
        !played.has(g.id) &&
        (g.homeTeamId === input.teamId || g.awayTeamId === input.teamId),
    )
    .sort((a, b) => a.date.day - b.date.day)[0];
  if (!next) return null;
  const home = next.homeTeamId === input.teamId;
  const odds = (win: boolean) =>
    playoffOdds({
      ...input,
      rng: new Rng(input.seed),
      fixed: { gameId: next.id, homeWins: home === win },
    }).get(input.teamId) ?? 0;
  return { ifWin: odds(true), ifLose: odds(false) };
}
