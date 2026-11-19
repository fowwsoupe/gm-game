import type { Player, TeamId } from '@gm/shared';
import { onRoster, type Emit, type LeagueState } from './core';
import { contractIn, countedHit, teamCapTotal } from './cba';
import { seenBy } from './people';
import { overall } from './players';
import { hurtOn } from './tonight';
import type { SimContext } from './context';

/**
 * AI teams move players between the roster and the farm on `day`, on their GM's read
 * (docs/research/2026-11-minor-leagues.md). On opening night (day 0) everyone signed competes for
 * the roster. Any day, a position injuries leave short calls up the best farm player there, and a
 * team with more healthy players than `roster.maxActive` sends the lowest down (never below a
 * position minimum), so a call-up goes back down when the injured player returns.
 * ponytail: a call-up must fit under the cap before the cuts that follow, so a team at the cap
 * keeps a good farm player down; swap in pairs if that matters.
 */
export function aiFarmMoves(state: LeagueState, ctx: SimContext, emit: Emit, day: number): void {
  const { ruleset } = ctx;
  const { maxActive, positionMin } = ruleset.roster;
  const byTeam = new Map<TeamId, Player[]>();
  for (const p of Object.values(state.players)) {
    if (p.teamId && p.contract) byTeam.set(p.teamId, [...(byTeam.get(p.teamId) ?? []), p]);
  }
  for (const [teamId, players] of [...byTeam].sort(([a], [b]) => a.localeCompare(b))) {
    const team = state.teams[teamId];
    if (!team || team.userControlled) continue;
    const read = (p: Player) => overall(seenBy(team, p));
    const best = (a: Player, b: Player) => read(b) - read(a) || a.id.localeCompare(b.id);
    const up = new Set(players.filter(onRoster));
    const healthy = (position?: string) =>
      players.filter((p) => up.has(p) && !hurtOn(p, day) && (!position || p.position === position));
    const farm = (position?: string) =>
      players.filter((p) => !up.has(p) && (!position || p.position === position)).sort(best);
    const season = state.date.season;
    let total = teamCapTotal(ruleset, state, teamId, players);
    const callUp = (p: Player) => {
      const hit = contractIn(p, season)?.capHit ?? 0;
      const lift = hit - countedHit(ruleset, p, hit);
      if (total + lift > ruleset.cap.upperLimit) return;
      up.add(p);
      total += lift;
    };
    if (day === 0) farm().forEach(callUp);
    for (const [position, min] of Object.entries(positionMin)) {
      if (healthy(position).length >= min) continue;
      for (const p of farm(position)) if (healthy(position).length < min) callUp(p);
    }
    while (healthy().length > maxActive) {
      const cut = healthy()
        .filter((p) => healthy(p.position).length > (positionMin[p.position] ?? 0))
        .sort(best)
        .at(-1);
      if (!cut) break;
      up.delete(cut);
    }
    for (const p of players
      .filter((x) => up.has(x) !== onRoster(x))
      .sort((a, b) => a.id.localeCompare(b.id))) {
      emit('minor', [teamId], {
        kind: 'player.assigned',
        playerId: p.id,
        teamId,
        ...(!up.has(p) && {
          league: ctx.sport.farmLeague(p.origin, season - p.birthYear, ruleset),
        }),
      });
    }
  }
}
