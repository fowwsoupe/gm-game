import type { Player, TeamId } from '@gm/shared';
import { available, teamName, type Emit, type LeagueState, type Rng } from '../core';
import type { SimContext } from '../context';
import { byOverall, overall } from '../players';
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

/** A camp battle: at `position`, the last player dressed and the best one left out (the order they play in). */
export interface CampBattle {
  position: string;
  group: Player[];
  spots: number;
}

/**
 * A team's camp battles: for each position, the last player the lineup dresses (the game's own
 * order, the GM's depth chart first) and the best one it leaves out, when their `overall` is within
 * `camp.battleGap`. `spots` come from `roster.positionMin`: the fewest a team carries at a
 * position is what it dresses.
 */
export function campBattles(state: LeagueState, ctx: SimContext, teamId: TeamId): CampBattle[] {
  const healthy = available(state, teamId, state.date.day);
  // The lineup lists a position's dressed players in the game's order (a goalie unit lists all).
  const order = ctx.sport
    .lineup(healthy, state.depthCharts[teamId])
    .flatMap((u) => u.playerIds)
    .flatMap((id) => healthy.filter((p) => p.id === id));
  const out: CampBattle[] = [];
  const mins = Object.entries(ctx.ruleset.roster.positionMin);
  // A team short at a position plays a spare out of position, so its slots are not clear: no battles.
  if (mins.some(([pos, n]) => healthy.filter((p) => p.position === pos).length < n)) return out;
  for (const [position, spots] of mins) {
    const dressed = order.filter((p) => p.position === position);
    const group = [
      ...dressed,
      ...healthy.filter((p) => p.position === position && !dressed.includes(p)).sort(byOverall),
    ];
    const [last, next] = [group[spots - 1], group[spots]];
    if (last && next && Math.abs(overall(last) - overall(next)) <= ctx.ruleset.camp.battleGap) {
      out.push({ position, group, spots });
    }
  }
  return out;
}

/**
 * The coach's read of a player at camp: his overall, plus a share of his upside for a young one,
 * off by noise that shrinks with the coach's quality (the camp report's rule).
 */
const campGrade = (p: Player, season: number, quality: number, ctx: SimContext, rng: Rng) => {
  const { youth, youthAge, readSd } = ctx.ruleset.camp;
  const upside = season - p.birthYear <= youthAge ? youth * (p.potential - overall(p)) : 0;
  return overall(p) + upside + rng.normal(0, (1 - quality) * readSd);
};

/**
 * The last day of camp. Each team's head coach picks a player in every battle. A human team gets
 * his pick as news (the GM plays whom he likes; advice only); an AI team dresses it, ahead of the
 * other in its depth order until `releaseCampOrders`. Each human team's coach also files his read
 * of the team's form (the form itself stays hidden); AI teams get none: they act on the standings.
 */
export function campReport(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  const sd = ctx.ruleset.season.form;
  for (const team of Object.values(state.teams).sort((a, b) => a.id.localeCompare(b.id))) {
    const coach = coachOf(team, ctx.ruleset.finance.coach, state.date.season);
    for (const { position, group, spots } of campBattles(state, ctx, team.id)) {
      const [last, next] = [group[spots - 1]!, group[spots]!];
      const grade = (p: Player) =>
        campGrade(p, state.date.season, coach.quality ?? 0.5, ctx, rng.fork(`${team.id}:${p.id}`));
      const [pick, other] = grade(next) > grade(last) ? [next, last] : [last, next];
      if (team.userControlled) {
        emit('notable', [team.id], {
          kind: 'news.posted',
          headline: 'event.camp.battle',
          params: {
            coach: coach.name,
            position,
            pick: `${pick.firstName} ${pick.lastName}`,
            other: `${other.firstName} ${other.lastName}`,
          },
          by: { role: 'coach', name: coach.name },
        });
      } else if (pick === next) {
        // Only the top of the group is listed: everyone after follows by rating.
        const order = group
          .slice(0, spots + 1)
          .map((p) => (p === last ? next : p === next ? last : p));
        emit('minor', [team.id], {
          kind: 'lines.set',
          teamId: team.id,
          // Kept after an earlier battle's order of the same team.
          order: [
            ...new Set([
              ...(state.depthCharts[team.id] ?? []).flatMap((id) => state.players[id] ?? []),
              ...order,
            ]),
          ].map((p) => p.id),
        });
      }
    }
    if (!team.userControlled) continue;
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

/** The coach's pick is a camp call, not a season's: AI teams go back to ratings. */
export function releaseCampOrders(state: LeagueState, emit: Emit): void {
  for (const team of Object.values(state.teams)) {
    if (!team.userControlled && state.depthCharts[team.id]?.length) {
      emit('minor', [team.id], { kind: 'lines.set', teamId: team.id, order: [] });
    }
  }
}
