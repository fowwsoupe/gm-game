import type { TeamId } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import { randomGm } from '../people';

/** Chance an AI GM moves on in a given summer, however his team did: about seven years in the job. */
const GM_LEAVES = 0.15;
/** Extra chance he is fired when his team finished in the league's bottom quarter. */
const FIRED_IF_BOTTOM = 0.4;

/**
 * Step 0 of the summer: some AI GMs leave and a new one (any style, any skill) takes over, so a
 * great GM does not run a team forever and a poor one gets fired. Human teams keep theirs.
 */
export function changeGms(state: LeagueState, rng: Rng, emit: Emit, worstFirst: readonly TeamId[]) {
  const bottom = new Set(worstFirst.slice(0, Math.floor(worstFirst.length / 4)));
  for (const teamId of [...worstFirst].sort()) {
    const team = state.teams[teamId];
    if (!team || team.userControlled) continue;
    const r = rng.fork(teamId);
    const fired = bottom.has(teamId) && r.chance(FIRED_IF_BOTTOM);
    if (!fired && !r.chance(GM_LEAVES)) continue;
    emit(fired ? 'notable' : 'minor', [teamId], {
      kind: 'team.gmChanged',
      teamId,
      gm: randomGm(r.fork('new')),
      fired,
    });
    emit('minor', [teamId], {
      kind: 'news.posted',
      headline: fired ? 'event.gmFired' : 'event.gmLeft',
      params: { team: `${team.city} ${team.name}` },
    });
  }
}
