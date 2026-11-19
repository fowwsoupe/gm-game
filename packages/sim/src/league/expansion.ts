import type { PlayerId, Team, TeamId } from '@gm/shared';
import type { LeagueState } from '../core';
import { payroll, type Ruleset } from '../cba';
import { overall } from '../players';

/** The division with the fewest teams (ties by name): where an expansion team plays. */
export function thinnestDivision(
  teams: readonly Team[],
): Pick<Team, 'conference' | 'division'> | undefined {
  const divisions = new Map<string, Team[]>();
  for (const t of teams)
    if (t.division) divisions.set(t.division, [...(divisions.get(t.division) ?? []), t]);
  const [[division, members] = []] = [...divisions].sort(
    (a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]),
  );
  const conference = members?.[0]?.conference;
  return division ? { ...(conference && { conference }), division } : undefined;
}

/**
 * The expansion draft: every team keeps its `protect` best players (and anyone with a no-trade
 * clause); the new team then takes the best of the rest, at most `maxLossPerTeam` from one team,
 * until it has `picks` players or no more cap room (a minimum salary kept for each open slot).
 */
export function expansionDraft(state: LeagueState, rules: Ruleset): PlayerId[] {
  const { protect, picks, maxLossPerTeam } = rules.expansion;
  const open = Object.values(state.players)
    .filter((p) => p.teamId && p.contract)
    .sort((a, b) => overall(b) - overall(a) || a.id.localeCompare(b.id));
  const kept = new Map<TeamId, number>();
  const exposed = open.filter((p) => {
    const n = kept.get(p.teamId!) ?? 0;
    kept.set(p.teamId!, n + 1);
    return n >= protect && !p.contract?.noTrade;
  });
  const lost = new Map<TeamId, number>();
  const taken: typeof open = [];
  for (const p of exposed) {
    if (taken.length >= picks) break;
    const slots = rules.roster.minActive - taken.length - 1;
    const room = rules.cap.upperLimit - payroll(taken) - p.contract!.capHit;
    if ((lost.get(p.teamId!) ?? 0) >= maxLossPerTeam || room < slots * rules.cap.minSalary)
      continue;
    lost.set(p.teamId!, (lost.get(p.teamId!) ?? 0) + 1);
    taken.push(p);
  }
  return taken.map((p) => p.id);
}
