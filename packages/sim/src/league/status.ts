import type { StandingsRow, TeamId, TeamStatus } from '@gm/shared';

/**
 * League pulse: classify each team's situation. Today a simple rule on points share;
 * later fed by playoff odds, cap space, roster age and owner goals (see the spec).
 * Kept behind this one function so the AI, the feed and the UI all agree.
 */
export function classifyTeams(rows: readonly StandingsRow[]): Record<TeamId, TeamStatus> {
  const out = {} as Record<TeamId, TeamStatus>;
  const n = rows.length;
  rows.forEach((r, rank) => {
    if (r.gp < 10) {
      out[r.teamId] = 'bubble';
      return;
    }
    const top = rank / n;
    out[r.teamId] =
      top < 0.2
        ? 'contender'
        : top < 0.4
          ? 'buyer'
          : top < 0.6
            ? 'bubble'
            : top < 0.85
              ? 'seller'
              : 'rebuilder';
  });
  return out;
}
