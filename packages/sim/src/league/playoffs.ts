import type { PlayoffSeries, StandingsRow, TeamId } from '@gm/shared';
import type { Ruleset } from '../cba';

/** A fixed bracket: adjacent slots meet, so the top two seeds cannot meet early. */
export function bracketSeeds(teamCount: number): number[] {
  if (teamCount < 2 || (teamCount & (teamCount - 1)) !== 0) {
    throw new Error('playoff field must be a power of two');
  }
  let slots = [1, 2];
  while (slots.length < teamCount) {
    const sum = slots.length * 2 + 1;
    slots = slots.flatMap((seed) => [seed, sum - seed]);
  }
  return slots;
}

export function seedPlayoffs(
  rows: readonly StandingsRow[],
  ruleset: Ruleset,
  season: number,
): PlayoffSeries[] {
  const count = ruleset.playoffs.teamsQualifying;
  if (rows.length < count || ruleset.playoffs.seeding !== 'points') {
    throw new Error('invalid playoff field');
  }
  const ranked = [...rows].sort(
    (a, b) =>
      b.pts - a.pts || b.w - a.w || b.gf - b.ga - (a.gf - a.ga) || a.teamId.localeCompare(b.teamId),
  );
  const slots = bracketSeeds(count);
  return Array.from({ length: count / 2 }, (_, i) => {
    const a = slots[i * 2]!;
    const b = slots[i * 2 + 1]!;
    return makeSeries(season, 1, i, a, ranked[a - 1]!.teamId, b, ranked[b - 1]!.teamId);
  });
}

export function makeSeries(
  season: number,
  round: number,
  slot: number,
  seedA: number,
  teamA: TeamId,
  seedB: number,
  teamB: TeamId,
): PlayoffSeries {
  const higher = seedA < seedB;
  return {
    id: `s${season}_${round}_${slot}`,
    round,
    higherSeed: higher ? seedA : seedB,
    lowerSeed: higher ? seedB : seedA,
    higherTeamId: higher ? teamA : teamB,
    lowerTeamId: higher ? teamB : teamA,
    higherWins: 0,
    lowerWins: 0,
  };
}

export function nextRound(won: readonly PlayoffSeries[]): PlayoffSeries[] {
  const sorted = [...won].sort(
    (a, b) => Number(a.id.split('_').at(-1)) - Number(b.id.split('_').at(-1)),
  );
  if (sorted.some((s) => !s.winnerTeamId) || sorted.length % 2 !== 0) {
    throw new Error('round is incomplete');
  }
  return Array.from({ length: sorted.length / 2 }, (_, i) => {
    const a = sorted[i * 2]!;
    const b = sorted[i * 2 + 1]!;
    const seedA = a.winnerTeamId === a.higherTeamId ? a.higherSeed : a.lowerSeed;
    const seedB = b.winnerTeamId === b.higherTeamId ? b.higherSeed : b.lowerSeed;
    const season = Number(a.id.split('_')[0]!.slice(1));
    return makeSeries(season, a.round + 1, i, seedA, a.winnerTeamId!, seedB, b.winnerTeamId!);
  });
}
