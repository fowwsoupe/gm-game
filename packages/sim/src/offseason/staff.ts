import type { StaffProfile, TeamId } from '@gm/shared';
import { FIRST, LAST, teamName, type Emit, type LeagueState, type Rng } from '../core';
import type { SimContext } from '../context';
import { DEPARTMENTS, ownerOf, staffOf, staffSalary } from '../people';
import { leagueStandings } from '../league';

/** A head this good or better makes league-wide news when he moves. */
const NEWS_QUALITY = 0.9;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Step 0b of the summer (docs/research/2026-11-front-office.md): department heads move on, good
 * ones on winning teams most often (hired away), and the owner's budget sets how good a
 * replacement the team finds. Every team alike: until the Front Office screen, a human team's
 * vacancy is filled the same way.
 */
export function changeStaff(
  state: LeagueState,
  ctx: SimContext,
  rng: Rng,
  emit: Emit,
  season: number,
) {
  const fo = ctx.ruleset.frontOffice;
  const win = ctx.ruleset.season.points.win;
  const pct = new Map<TeamId, number>(
    leagueStandings(state, ctx.ruleset).map((r) => [r.teamId, r.gp ? r.pts / (win * r.gp) : 0.5]),
  );
  const values = [...pct.values()];
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const sd = Math.sqrt(
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length),
  );
  for (const teamId of (Object.keys(state.teams) as TeamId[]).sort()) {
    const team = state.teams[teamId]!;
    const z = sd > 0 ? ((pct.get(teamId) ?? mean) - mean) / sd : 0;
    for (const department of DEPARTMENTS) {
      const r = rng.fork(`${teamId}:${department}`);
      const gone = staffOf(team, department, fo.salary, season);
      const poachChance = fo.poach * gone.quality * Math.max(0, z);
      const leaves = r.chance(fo.leave);
      const poached = !leaves && r.chance(poachChance);
      if (!leaves && !poached) continue;
      const centre = 0.5 + fo.spend * (ownerOf(team).budget - 0.5);
      const quality = Math.round(clamp01(r.normal(centre, fo.hireSd)) * 100) / 100;
      const head: StaffProfile = {
        name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
        quality,
        hired: season,
        salary: staffSalary(quality, fo.salary),
      };
      const yours = team.userControlled;
      emit(yours ? 'notable' : 'minor', [teamId], {
        kind: 'staff.hired',
        teamId,
        department,
        head,
        poached,
      });
      if (yours || (poached && gone.quality >= NEWS_QUALITY)) {
        emit(yours ? 'notable' : 'minor', [teamId], {
          kind: 'news.posted',
          headline: poached ? 'event.staffPoached' : 'event.staffLeft',
          params: { team: teamName(team), dept: department, name: gone.name, next: head.name },
        });
      }
    }
  }
}
