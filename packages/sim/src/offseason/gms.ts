import type { TeamId } from '@gm/shared';
import { teamName, type Emit, type LeagueState, type Rng } from '../core';
import { choosePlan, gmOf, randomGm, seenBy } from '../people';
import { overall } from '../players';
import { aiGmFired } from '../owner';

/** Chance an AI GM moves on in a given summer, however his team did: about seven years in the job. */
const GM_LEAVES = 0.15;

/**
 * Step 0 of the summer: some AI GMs leave, and those who lost their owner's confidence are fired;
 * a new one (any style, any skill) takes over. Human teams keep theirs (their owner fires them at
 * the review). The teams left with a vacancy are offered to a human GM out of work.
 */
export function changeGms(state: LeagueState, rng: Rng, emit: Emit) {
  const vacancies: TeamId[] = [];
  for (const teamId of (Object.keys(state.teams) as TeamId[]).sort()) {
    const team = state.teams[teamId]!;
    if (team.userControlled) continue;
    const r = rng.fork(teamId);
    const fired = aiGmFired(state, teamId);
    if (!fired && !r.chance(GM_LEAVES)) continue;
    vacancies.push(teamId);
    emit(fired ? 'notable' : 'minor', [teamId], {
      kind: 'team.gmChanged',
      teamId,
      gm: randomGm(r.fork('new')),
      fired,
    });
    emit('minor', [teamId], {
      kind: 'news.posted',
      headline: fired ? 'event.gmFired' : 'event.gmLeft',
      params: { team: teamName(team) },
    });
  }
  // ponytail: one GM out of work at a time; a list of careers when multiplayer needs it.
  const career = state.career;
  if (career) {
    const offers = vacancies.filter((id) => id !== career.firedFrom);
    emit('major', [], { kind: 'career.offers', offers });
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
    const before = team.plan; // emit applies the event, so read it first
    if (before?.kind === kind) continue;
    emit('minor', [team.id], {
      kind: 'team.planChanged',
      teamId: team.id,
      plan: { kind, since: season },
    });
    if (kind === 'retool' || !before) continue;
    emit('notable', [team.id], {
      kind: 'news.posted',
      headline: kind === 'rebuild' ? 'event.planRebuild' : 'event.planContend',
      params: { team: teamName(team) },
    });
  }
}
