import type { RecordEntry, StandingsRow, TeamId } from '@gm/shared';

/**
 * League records from finished seasons: a team's best single season for points, wins and goals
 * for, its fewest goals against, and the most titles all-time. The earliest season keeps a tie.
 * TODO(M2): player records (goals, points, saves) once games have box scores.
 */
export function teamRecords(
  seasons: readonly { season: number; rows: readonly StandingsRow[] }[],
  champions: readonly TeamId[],
): RecordEntry[] {
  const out = new Map<RecordEntry['key'], RecordEntry>();
  const consider = (key: RecordEntry['key'], teamId: TeamId, season: number, value: number) => {
    const cur = out.get(key);
    // Fewest goals against is the only record where lower wins.
    const better = !cur || (key === 'goalsAgainst' ? value < cur.value : value > cur.value);
    if (better) out.set(key, { key, teamId, season, value });
  };
  for (const { season, rows } of [...seasons].sort((a, b) => a.season - b.season)) {
    for (const r of rows) {
      consider('points', r.teamId, season, r.pts);
      consider('wins', r.teamId, season, r.w);
      consider('goalsFor', r.teamId, season, r.gf);
      consider('goalsAgainst', r.teamId, season, r.ga);
    }
  }
  const titles = new Map<TeamId, number>();
  for (const id of champions) titles.set(id, (titles.get(id) ?? 0) + 1);
  const [top] = [...titles].sort((a, b) => b[1] - a[1]);
  if (top) out.set('titles', { key: 'titles', teamId: top[0], value: top[1] });
  return [...out.values()];
}
