import { teamName, type Emit, type LeagueState, type Rng } from '../core';
import type { SimContext } from '../context';
import { coachOf } from './owner';

/** The coach's word for a team's form at the end of camp. */
type CampRead = 'sharp' | 'expected' | 'flat';

/** Half a form SD either way is "as expected". */
const wordFor = (form: number, sd: number): CampRead =>
  form > sd / 2 ? 'sharp' : form < -sd / 2 ? 'flat' : 'expected';

/**
 * A coach's read of his team's form: the truth plus noise that shrinks with his quality
 * (SD `(1 - quality) x form SD`), so a poor coach can call a flat team sharp.
 */
export const campRead = (form: number, quality: number, sd: number, rng: Rng): CampRead =>
  wordFor(form + rng.normal(0, (1 - quality) * sd), sd);

/**
 * The last day of camp: each human team's head coach files his read of the team's form (the
 * form itself stays hidden). AI teams get none: they act on the standings.
 */
export function campReport(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  const sd = ctx.ruleset.season.form;
  for (const team of Object.values(state.teams).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!team.userControlled) continue;
    const coach = coachOf(team, ctx.ruleset.finance.coach, state.date.season);
    const read = campRead(
      state.teamForm[team.id] ?? 0,
      coach.quality ?? 0.5,
      sd,
      rng.fork(team.id),
    );
    emit('notable', [team.id], {
      kind: 'news.posted',
      headline: `event.camp.${read}`,
      params: { coach: coach.name, team: teamName(team) },
      by: { role: 'coach', name: coach.name },
    });
  }
}
