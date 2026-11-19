import type { StandingsRow, TeamId, TeamStatus } from '@gm/shared';

/** What the pulse reads about a team besides the table. */
export interface PulseInput {
  /** Playoff odds, 0-1. */
  odds: number;
  /** Average age of its core (best players). */
  age: number;
  /** Cap space as a share of the upper limit (negative when over). */
  capRoom: number;
}

/** Share of the league, ranked by playoff odds, above each status's floor. */
const CUTS: readonly [number, TeamStatus][] = [
  [0.2, 'contender'],
  [0.4, 'buyer'],
  [0.6, 'bubble'],
  [0.85, 'seller'],
];
/** A core this many SDs younger (older) than the league's average age is young (old). */
const AGE_Z = 1;

/**
 * League pulse: classify each team's situation. Teams are ranked by playoff odds (the standings
 * break ties), then roster age and cap space shift the call: a young team out of it is a
 * rebuilder rather than a seller, an old bubble team with more cap space than most a buyer.
 * `rows` in standings order; with no `inputs` the standings alone decide. Kept behind this one
 * function so the AI, the feed and the UI all agree (advance.ts adds crisis on top).
 */
export function classifyTeams(
  rows: readonly StandingsRow[],
  inputs: ReadonlyMap<TeamId, PulseInput>,
): Record<TeamId, TeamStatus> {
  const out = {} as Record<TeamId, TeamStatus>;
  const n = rows.length;
  const all = [...inputs.values()];
  const mean = (f: (x: PulseInput) => number) =>
    all.reduce((s, x) => s + f(x), 0) / Math.max(1, all.length);
  const avgAge = mean((x) => x.age);
  const sdAge = Math.sqrt(mean((x) => (x.age - avgAge) ** 2)) || 1;
  const avgRoom = mean((x) => x.capRoom);
  const ranked = rows
    .map((r, i) => ({ r, i, odds: inputs.get(r.teamId)?.odds ?? 0 }))
    .sort((a, b) => b.odds - a.odds || a.i - b.i);
  ranked.forEach(({ r }, rank) => {
    if (r.gp < 10) {
      out[r.teamId] = 'bubble';
      return;
    }
    const top = rank / n;
    let status = CUTS.find(([cut]) => top < cut)?.[1] ?? 'rebuilder';
    const input = inputs.get(r.teamId);
    if (input) {
      const age = (input.age - avgAge) / sdAge;
      if (status === 'seller' && age <= -AGE_Z) status = 'rebuilder';
      if (status === 'bubble' && age >= AGE_Z && input.capRoom > avgRoom) status = 'buyer';
    }
    out[r.teamId] = status;
  });
  return out;
}
