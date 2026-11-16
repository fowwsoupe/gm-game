import type { TeamId } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import { choosePlan, gmOf, randomGm, seenBy } from '../people';
import { overall } from '../players';

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

/** The best players a GM counts as his core. */
export const CORE = 8;

/**
 * Step 2b: every AI GM looks at his core (his best players as he sees them, after this summer's
 * development and retirements) against the league's and sets his plan: contend, retool or
 * rebuild. A change is news when it is a rebuild or going all in.
 */
export function setPlans(state: LeagueState, emit: Emit, season: number) {
  const teams = Object.values(state.teams).sort((a, b) => a.id.localeCompare(b.id));
  const cores = teams.map((team) => {
    const best = Object.values(state.players)
      .filter((p) => p.teamId === team.id)
      .map((p) => ({ rating: overall(seenBy(team, p)), age: season - p.birthYear }))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, CORE);
    const mean = (f: (x: { rating: number; age: number }) => number) =>
      best.length ? best.reduce((s, x) => s + f(x), 0) / best.length : 0;
    return { team, quality: mean((x) => x.rating), age: mean((x) => x.age) };
  });
  const avg = cores.reduce((s, c) => s + c.quality, 0) / Math.max(1, cores.length);
  const sd =
    Math.sqrt(cores.reduce((s, c) => s + (c.quality - avg) ** 2, 0) / Math.max(1, cores.length)) ||
    1;
  for (const { team, quality, age } of cores) {
    if (team.userControlled) continue;
    const kind = choosePlan({
      coreZ: (quality - avg) / sd,
      coreAge: age,
      style: gmOf(team).style,
      current: team.plan,
      season,
    });
    if (team.plan?.kind === kind) continue;
    emit('minor', [team.id], {
      kind: 'team.planChanged',
      teamId: team.id,
      plan: { kind, since: season },
    });
    if (kind === 'retool' || !team.plan) continue;
    emit('notable', [team.id], {
      kind: 'news.posted',
      headline: kind === 'rebuild' ? 'event.planRebuild' : 'event.planContend',
      params: { team: `${team.city} ${team.name}` },
    });
  }
}
