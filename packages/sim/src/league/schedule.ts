import type { GameId, Team, TeamId } from '@gm/shared';
import type { Rng, ScheduledGame } from '../core';

type Slot = Pick<Team, 'id' | 'conference' | 'division'>;

/** How much more a division rival (3) or conference rival (2) is played than the rest (1). */
function weight(a: Slot, b: Slot): number {
  if (a.division && a.division === b.division) return 3;
  if (a.conference && a.conference === b.conference) return 2;
  return 1;
}

/**
 * One season's schedule: every team plays exactly `gamesPerTeam` games (an odd team count leaves
 * one team idle per round), division rivals most, then the conference, then the rest. Home and
 * away are balanced, and games are spread over `days` with a few back-to-backs. Teams without
 * a conference or division get a flat schedule.
 *
 * TODO(feature): travel, arena conflicts, breaks (all-star, Olympics).
 */
export function makeSchedule(
  season: number,
  teams: readonly Slot[],
  gamesPerTeam: number,
  days: number,
  rng: Rng,
): ScheduledGame[] {
  const n = teams.length;
  const w = (i: number, j: number) => weight(teams[i]!, teams[j]!);
  const key = (i: number, j: number) => (i < j ? i * n + j : j * n + i);

  // 1. Games per pair: the same for each kind of pair, rounded down.
  const total = (i: number) => teams.reduce((s, _, j) => s + (j === i ? 0 : w(i, j)), 0);
  const sum = teams.map((_, i) => total(i));
  const count = new Map<number, number>();
  const played = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = Math.floor((gamesPerTeam * w(i, j)) / Math.max(sum[i]!, sum[j]!));
      count.set(key(i, j), c);
      played[i]! += c;
      played[j]! += c;
    }
  }

  // 2. Top up the remainder in passes, pairing teams that still owe games. Favouring pairs
  //    with a high weight and few games so far keeps rivals ahead without repeating one pair.
  for (let progress = true; progress;) {
    progress = false;
    const order = rng.shuffle([...teams.keys()]).filter((i) => played[i]! < gamesPerTeam);
    const taken = new Set<number>();
    for (const i of order) {
      if (taken.has(i)) continue;
      let best = -1;
      let bestScore = -1;
      for (const j of order) {
        if (j === i || taken.has(j)) continue;
        const score = w(i, j) / (1 + (count.get(key(i, j)) ?? 0));
        if (score > bestScore) [best, bestScore] = [j, score];
      }
      if (best < 0) continue;
      taken.add(i).add(best);
      count.set(key(i, best), (count.get(key(i, best)) ?? 0) + 1);
      played[i]!++;
      played[best]!++;
      progress = true;
    }
  }

  // 3. Home and away: split each pair evenly, and give an odd game to whoever has hosted less.
  const surplus = new Array<number>(n).fill(0); // home games minus away games so far
  const matchups: { home: TeamId; away: TeamId }[] = [];
  for (const k of rng.shuffle([...count.keys()])) {
    const [i, j] = [Math.floor(k / n), k % n];
    const c = count.get(k)!;
    const extraHome = c % 2 === 0 ? -1 : surplus[i]! <= surplus[j]! ? i : j;
    for (let g = 0; g < c; g++) {
      const hostI = extraHome === -1 ? g % 2 === 0 : g === 0 ? extraHome === i : g % 2 === 1;
      const [h, a] = hostI ? [i, j] : [j, i];
      surplus[h]!++;
      surplus[a]!--;
      matchups.push({ home: teams[h]!.id, away: teams[a]!.id });
    }
  }

  // 4. Days: each team plays on a day with the chance it needs to finish on time. A team
  //    that played yesterday rarely plays again (a back-to-back). If that leaves games
  //    over, redo it with no rest rule: a full calendar always has room.
  const horizon = days - 15; // leave the last weeks free for stragglers
  const place = (strict: boolean) => {
    const left = rng.shuffle([...matchups]);
    const need = new Map<TeamId, number>();
    for (const m of left) {
      need.set(m.home, (need.get(m.home) ?? 0) + 1);
      need.set(m.away, (need.get(m.away) ?? 0) + 1);
    }
    const lastDay = new Map<TeamId, number>();
    const out: { day: number; m: (typeof matchups)[number] }[] = [];
    for (let day = 0; day < days && left.length > 0; day++) {
      const free = new Set<TeamId>();
      for (const [id, c] of need) {
        const late = !strict || day >= horizon;
        const pace = late ? 1 : Math.min(1, (1.4 * c) / (horizon - day));
        const rested = late || lastDay.get(id) !== day - 1 || c >= (horizon - day) * 0.9;
        if (c > 0 && rng.chance(rested ? pace : pace * 0.15)) free.add(id);
      }
      for (let i = 0; i < left.length;) {
        const m = left[i]!;
        if (!free.has(m.home) || !free.has(m.away)) {
          i++;
          continue;
        }
        free.delete(m.home);
        free.delete(m.away);
        for (const id of [m.home, m.away]) {
          need.set(id, need.get(id)! - 1);
          lastDay.set(id, day);
        }
        out.push({ day, m });
        left.splice(i, 1);
      }
    }
    return left.length === 0 ? out : null;
  };
  const placed = place(true) ?? place(false);
  if (!placed) throw new Error(`cannot fit ${gamesPerTeam} games per team into ${days} days`);

  return placed.map(({ day, m }, i) => ({
    id: `g${season}_${i}` as GameId,
    date: { season, day },
    homeTeamId: m.home,
    awayTeamId: m.away,
  }));
}
