import type { GameResult, HockeyBoxScore, Leaderboard, Player, PlayerId, TeamId } from '@gm/shared';

export interface SkaterTotals {
  gp: number;
  goals: number;
  assists: number;
  shots: number;
  plusMinus: number;
  /** Minutes on ice. */
  toi: number;
}
export interface GoalieTotals {
  gp: number;
  shotsAgainst: number;
  saves: number;
}

/** Adds up the box scores of the given games, per player. */
export function hockeySeasonStats(results: readonly GameResult[]) {
  const skaters = new Map<string, SkaterTotals>();
  const goalies = new Map<string, GoalieTotals>();
  for (const game of results) {
    const box = game.box as HockeyBoxScore | undefined;
    if (!box) continue;
    for (const side of [box.home, box.away]) {
      for (const line of side.skaters) {
        const t = skaters.get(line.id) ?? {
          gp: 0,
          goals: 0,
          assists: 0,
          shots: 0,
          plusMinus: 0,
          toi: 0,
        };
        t.gp++;
        t.goals += line.goals;
        t.assists += line.assists;
        t.shots += line.shots;
        t.plusMinus += line.plusMinus;
        t.toi += line.toi;
        skaters.set(line.id, t);
      }
      for (const g of [side.goalie, side.relief]) {
        if (!g?.id) continue;
        const t = goalies.get(g.id) ?? { gp: 0, shotsAgainst: 0, saves: 0 };
        t.gp++;
        t.shotsAgainst += g.shotsAgainst;
        t.saves += g.saves;
        goalies.set(g.id, t);
      }
    }
  }
  return { skaters, goalies };
}

/** Stat lines for player cards: skaters get points and shots, goalies saves and save %. */
export function hockeyPlayerLines(results: readonly GameResult[]) {
  const { skaters, goalies } = hockeySeasonStats(results);
  const lines = new Map<string, Record<string, number>>();
  for (const [id, t] of skaters) {
    lines.set(id, {
      gp: t.gp,
      goals: t.goals,
      assists: t.assists,
      points: t.goals + t.assists,
      plusMinus: t.plusMinus,
      shots: t.shots,
    });
  }
  for (const [id, g] of goalies) {
    lines.set(id, {
      gp: g.gp,
      shotsAgainst: g.shotsAgainst,
      saves: g.saves,
      savePct: g.shotsAgainst > 0 ? g.saves / g.shotsAgainst : 0,
    });
  }
  return lines;
}

/**
 * Top players by points, goals, assists and save percentage. A goalie needs a quarter of the
 * games the busiest goalie played to qualify for save percentage.
 */
export function hockeyLeaders(
  results: readonly GameResult[],
  players: readonly Player[],
  limit: number,
): Leaderboard[] {
  const { skaters, goalies } = hockeySeasonStats(results);
  const byId = new Map(players.map((p) => [p.id as string, p]));
  const board = (
    key: string,
    entries: [string, number, number][], // [player id, games, value]
  ): Leaderboard => ({
    key,
    rows: entries
      .sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .flatMap(([id, gp, value]) => {
        const p = byId.get(id);
        return p
          ? [{ playerId: p.id, name: `${p.firstName} ${p.lastName}`, teamId: p.teamId, gp, value }]
          : [];
      }),
  });
  const skater = (value: (t: SkaterTotals) => number) =>
    [...skaters].map(([id, t]) => [id, t.gp, value(t)] as [string, number, number]);
  const busiest = Math.max(0, ...[...goalies.values()].map((g) => g.gp));
  return [
    board(
      'points',
      skater((t) => t.goals + t.assists),
    ),
    board(
      'goals',
      skater((t) => t.goals),
    ),
    board(
      'assists',
      skater((t) => t.assists),
    ),
    board(
      'savePct',
      [...goalies]
        .filter(([, g]) => g.gp >= busiest / 4 && g.shotsAgainst > 0)
        .map(([id, g]) => [id, g.gp, g.saves / g.shotsAgainst] as [string, number, number]),
    ),
  ];
}

/** Hat tricks (3+ goals) and shutouts (a goalie who played the whole game and allowed none). */
export function hockeyHighlights(result: GameResult) {
  const box = result.box as HockeyBoxScore | undefined;
  if (!box) return [];
  const out: { key: string; playerId: PlayerId; teamId: TeamId }[] = [];
  const sides = [
    [box.home, result.homeTeamId, result.awayScore],
    [box.away, result.awayTeamId, result.homeScore],
  ] as const;
  for (const [side, teamId, against] of sides) {
    for (const line of side.skaters) {
      if (line.goals >= 3) out.push({ key: 'hatTrick', playerId: line.id as PlayerId, teamId });
    }
    if (against === 0 && !side.relief && side.goalie.id) {
      out.push({ key: 'shutout', playerId: side.goalie.id as PlayerId, teamId });
    }
  }
  return out;
}

/**
 * Hall of Fame rule (hockey, for a 16-team, 84-game league where the scoring champion has about
 * 90 points): skaters with 1,000 career points or two MVPs; goalies with 800 games or two Top
 * Goalie awards. About one inductee a season over a 20-year league. Totals sum the season lines (save % recomputed from saves and shots).
 */
export function hockeyHallOfFame(input: {
  position: string;
  seasons: readonly Record<string, number>[];
  awards: readonly string[];
}) {
  const totals: Record<string, number> = {};
  for (const line of input.seasons) {
    for (const [k, v] of Object.entries(line))
      if (k !== 'savePct') totals[k] = (totals[k] ?? 0) + v;
  }
  const won = (award: string) => input.awards.filter((a) => a === award).length;
  if (input.position === 'G') {
    if (totals.shotsAgainst) totals.savePct = (totals.saves ?? 0) / totals.shotsAgainst;
    return { inducted: (totals.gp ?? 0) >= 800 || won('topGoalie') >= 2, totals };
  }
  return { inducted: (totals.points ?? 0) >= 1000 || won('mvp') >= 2, totals };
}
