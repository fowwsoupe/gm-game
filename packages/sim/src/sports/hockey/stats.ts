import type { GameResult, HockeyBoxScore, Leaderboard, Player } from '@gm/shared';

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
      const g = side.goalie;
      if (g.id) {
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
