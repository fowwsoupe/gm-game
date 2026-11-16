import {
  isGoalie,
  type Player,
  type PlayoffSeries,
  type StandingsRow,
  type Team,
  type TeamId,
} from '@gm/shared';
import type { Ruleset } from '../cba';
import { overall } from '../players';

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

/**
 * First-round series. With conference seeding, each of two conferences sends its best
 * `teamsQualifying / 2` teams into its own bracket, and the two conference winners meet in the
 * final. A series' seed is always the team's rank in the whole league, so the final's higher seed
 * (home ice) is the better regular season. Without usable conferences it is one league-wide bracket.
 * TODO(feature): wild cards and division brackets.
 */
export function seedPlayoffs(
  rows: readonly StandingsRow[],
  ruleset: Ruleset,
  season: number,
  teams: readonly Pick<Team, 'id' | 'conference'>[] = [],
): PlayoffSeries[] {
  const count = ruleset.playoffs.teamsQualifying;
  if (rows.length < count) throw new Error('invalid playoff field');
  const ranked = [...rows].sort(
    (a, b) =>
      b.pts - a.pts || b.w - a.w || b.gf - b.ga - (a.gf - a.ga) || a.teamId.localeCompare(b.teamId),
  );
  const rank = new Map(ranked.map((r, i) => [r.teamId, i + 1]));
  const conferenceOf = new Map(teams.map((t) => [t.id, t.conference]));
  const conferences = [...new Set(ranked.map((r) => conferenceOf.get(r.teamId)))];
  const groups =
    ruleset.playoffs.seeding === 'conference' &&
    conferences.length === 2 &&
    !conferences.includes(undefined)
      ? conferences.map((c) =>
          ranked.filter((r) => conferenceOf.get(r.teamId) === c).slice(0, count / 2),
        )
      : [ranked.slice(0, count)];
  if (groups.some((g) => g.length * groups.length < count)) {
    return seedPlayoffs(
      rows,
      { ...ruleset, playoffs: { ...ruleset.playoffs, seeding: 'points' } },
      season,
    );
  }

  const out: PlayoffSeries[] = [];
  for (const group of groups) {
    const slots = bracketSeeds(group.length);
    for (let i = 0; i < group.length / 2; i++) {
      const a = group[slots[i * 2]! - 1]!.teamId;
      const b = group[slots[i * 2 + 1]! - 1]!.teamId;
      out.push(makeSeries(season, 1, out.length, rank.get(a)!, a, rank.get(b)!, b));
    }
  }
  return out;
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

/**
 * Teams that break the playoff cap: the best skaters and goalies (by rating, as the lineup
 * would dress them) cost more in cap hits than the upper limit. Nobody can today, since the
 * whole roster must fit under the cap; this guards the day in-season overage or retention exists.
 * TODO(M5): the consequence (a compliance warning, forced moves) once the cap sheet exists.
 */
export function playoffCapBreaches(players: readonly Player[], ruleset: Ruleset): TeamId[] {
  const rule = ruleset.cap.playoffCap;
  if (!rule) return [];
  const byTeam = new Map<TeamId, Player[]>();
  for (const p of players) {
    if (p.teamId) byTeam.set(p.teamId, [...(byTeam.get(p.teamId) ?? []), p]);
  }
  const cost = (roster: Player[], goalie: boolean, n: number) =>
    roster
      .filter((p) => isGoalie(p.position) === goalie)
      .sort((a, b) => overall(b) - overall(a))
      .slice(0, n)
      .reduce((sum, p) => sum + (p.contract?.capHit ?? 0), 0);
  return [...byTeam]
    .filter(
      ([, roster]) =>
        cost(roster, false, rule.skaters) + cost(roster, true, rule.goalies) >
        ruleset.cap.upperLimit,
    )
    .map(([id]) => id);
}
