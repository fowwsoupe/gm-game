import type {
  Department,
  DepartmentReturns,
  HallOfFamer,
  StaffProfile,
  Team,
  TeamId,
} from '@gm/shared';
import { FIRST, LAST, Rng, teamName, type Emit, type LeagueState } from '../core';
import type { SimContext } from '../context';
import {
  assistantSees,
  departmentsOf,
  hash,
  hireQuality,
  ownerOf,
  staffOf,
  staffSalary,
} from '../people';
import { leagueStandings } from '../league';
import { overall } from '../players';
import { teamRange } from './draft';

/** A head this good or better makes league-wide news when he moves. */
const NEWS_QUALITY = 0.9;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Step 0b of the summer (docs/research/2026-11-front-office.md): department heads move on, good
 * ones on winning teams most often (hired away), and the owner's budget sets how good a
 * replacement the team finds. Every team alike: a human team's vacancy is filled the same way,
 * and its GM can then replace the head from the Front Office screen (`staff.hire`).
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
    for (const department of departmentsOf(team)) {
      const r = rng.fork(`${teamId}:${department}`);
      const gone = staffOf(team, department, fo.salary, season);
      const poachChance = fo.poach * gone.quality * Math.max(0, z);
      const leaves = r.chance(fo.leave);
      const poached = !leaves && r.chance(poachChance);
      if (!leaves && !poached) continue;
      const quality = hireQuality(r, team, fo);
      const head: StaffProfile = {
        name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
        quality,
        // The season just played: a summer replacement never uses up the GM's own hire.
        hired: state.date.season,
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

/** How far apart the three candidates' qualities sit: a cheap one, the owner's usual, a dear one. */
const CANDIDATE_STEP = 0.25;

/** Where a goalie legend fits; a skater legend fits the other departments. */
const GOALIE_DEPARTMENTS: Department[] = ['medical', 'development'];

/**
 * The Hall of Famer who offers his services to a team this season, in at most one department:
 * one legend and one fitting department a team-season, drawn from the team and season alone.
 * His quality comes from his career (awards won); he is not offered where he already works.
 */
function legendCandidate(
  team: Team,
  department: Department,
  ctx: SimContext,
  season: number,
  legends: readonly HallOfFamer[],
): StaffProfile | undefined {
  if (!legends.length) return undefined;
  const r = new Rng(hash(`legend:${team.id}:${season}`));
  const legend = r.pick(legends);
  const fits = departmentsOf(team).filter(
    (d) => GOALIE_DEPARTMENTS.includes(d) === (legend.position === 'G'),
  );
  if (!fits.length || r.pick(fits) !== department) return undefined;
  if (Object.values(team.staff ?? {}).some((h) => h.name === legend.name)) return undefined;
  const quality = Math.min(0.95, 0.6 + 0.07 * Math.min(legend.awards.length, 4));
  return {
    name: legend.name,
    quality,
    hired: season,
    salary: staffSalary(quality, ctx.ruleset.frontOffice.salary),
    legend: true,
  };
}

/**
 * The three people a human GM can hire for a department this season, cheapest first. Centred
 * on what the owner spends, like the AI's hires; the same all season, so nothing is stored.
 * A Hall of Famer (`legends`, from the save) can take the dearest slot, see `legendCandidate`.
 */
export function staffCandidates(
  team: Team,
  department: Department,
  ctx: SimContext,
  season: number,
  legends: readonly HallOfFamer[] = [],
): StaffProfile[] {
  const fo = ctx.ruleset.frontOffice;
  const centre = 0.5 + fo.spend * (ownerOf(team).budget - 0.5);
  const r = new Rng(hash(`candidates:${team.id}:${department}:${season}`));
  const out = [-1, 0, 1].map((step) => {
    const quality =
      Math.round(clamp01(centre + step * CANDIDATE_STEP + r.normal(0, fo.hireSd / 2)) * 100) / 100;
    return {
      name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
      quality,
      hired: season,
      salary: staffSalary(quality, fo.salary),
    };
  });
  const legend = legendCandidate(team, department, ctx, season, legends);
  if (legend) out[2] = legend;
  return out;
}

/** The stand-in who runs a department after you fire its head: `frontOffice.interim` quality, not a market hire. */
export function interimHead(
  team: Team,
  department: Department,
  ctx: SimContext,
  season: number,
): StaffProfile {
  const fo = ctx.ruleset.frontOffice;
  const r = new Rng(hash(`interim:${team.id}:${department}:${season}`));
  return {
    name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
    quality: fo.interim,
    hired: season,
    salary: staffSalary(fo.interim, fo.salary),
  };
}

/**
 * What a team's departments return against the league's average one, worked out from their
 * quality and the ruleset (nothing is recorded, so it is the head in the job now): development's
 * points a year for a player 24 or younger, medical's share of injury days saved, and how far
 * the scouts' read of the picks of the newest draft class still on the team was off the truth,
 * and how far the assistant's read of the roster is off (he reads players as an AI GM of his
 * skill would, so a poor one is wrong about the same players until replaced).
 */
export function departmentReturns(
  state: LeagueState,
  ctx: SimContext,
  teamId: TeamId,
): DepartmentReturns {
  const fo = ctx.ruleset.frontOffice;
  const season = state.date.season;
  const teams = Object.values(state.teams);
  const q = (t: Team, d: Department) => staffOf(t, d, fo.salary, season).quality;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const avg = (d: Department) => mean(teams.map((t) => q(t, d)));
  const mine = state.teams[teamId]!;
  const draftOf = (p: { id: string }) => Number(/^d(\d+)_/.exec(p.id)?.[1] ?? 0);
  const players = Object.values(state.players).filter((p) => p.teamId && draftOf(p));
  const newest = Math.max(0, ...players.map(draftOf));
  const missOf = (t: Team) => {
    const picks = players.filter((p) => p.teamId === t.id && draftOf(p) === newest);
    const miss = picks.map((p) => {
      const r = teamRange(t, { player: p, low: 0, high: 0 }, ctx, season);
      return Math.abs((r.low + r.high) / 2 - p.potential);
    });
    return { n: miss.length, error: mean(miss) };
  };
  const mineMiss = missOf(mine);
  const assistant = departmentsOf(mine).includes('assistant')
    ? staffOf(mine, 'assistant', fo.salary, season)
    : null;
  const roster = Object.values(state.players).filter((p) => p.teamId === teamId);
  return {
    assistant:
      assistant && roster.length
        ? {
            error: mean(
              roster.map((p) =>
                Math.abs(overall(assistantSees(assistant, teamId, p)) - overall(p)),
              ),
            ),
            players: roster.length,
          }
        : null,
    development: (q(mine, 'development') - avg('development')) * 2 * fo.development.points,
    medical: fo.medical.days * (q(mine, 'medical') - avg('medical')) * 100,
    scouting: mineMiss.n
      ? {
          error: mineMiss.error,
          league: mean(
            teams
              .map(missOf)
              .filter((m) => m.n)
              .map((m) => m.error),
          ),
          picks: mineMiss.n,
        }
      : null,
  };
}
