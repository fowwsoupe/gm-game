import type { CoachProfile, Department, OwnerProfile, StaffProfile, Team } from '@gm/shared';
import { FIRST, LAST, Rng } from '../core';
import { hash } from './personality';

/** A coach's deal, from the ruleset (`finance.coach`). */
type CoachTerms = { salary: number; years: number };

/** A new head coach: a fictional name, on the league's usual deal from `hired`. */
export const newCoach = (rng: Rng, hired: number, terms: CoachTerms): CoachProfile => ({
  name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
  hired,
  ...terms,
});

/**
 * A team's head coach; an old save's is derived from the team id (`season` is today's, so his
 * deal sits at the same point every season until he is replaced).
 */
export function coachOf(team: Team, terms: CoachTerms, season: number): CoachProfile {
  const rng = new Rng(hash(`coach:${team.id}`));
  const coach = team.coach ?? newCoach(rng, season - Math.floor(rng.next() * terms.years), terms);
  return coach.quality === undefined ? { ...coach, quality: qualityOf(coach) } : coach;
}

/** A coach's quality when none is stored: from his name and first season, no league draw. */
const qualityOf = (c: CoachProfile) =>
  round2(new Rng(hash(`coachQuality:${c.name}:${c.hired}`)).next());

export const DEPARTMENTS: readonly Department[] = ['scouting', 'development', 'medical'];

/** A department head's salary: rises with quality squared, to the nearest $10K. */
export const staffSalary = (quality: number, range: { min: number; max: number }) =>
  Math.round((range.min + quality ** 2 * (range.max - range.min)) / 10_000) * 10_000;

/**
 * A team's department head; one not stored is derived from the team id (`season` is today's, so
 * he has been in the job the same number of seasons until he is replaced).
 */
export function staffOf(
  team: Team,
  dept: Department,
  salary: { min: number; max: number },
  season: number,
): StaffProfile {
  const stored = team.staff?.[dept];
  if (stored) return stored;
  const rng = new Rng(hash(`staff:${dept}:${team.id}`));
  const name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
  const quality = round2(rng.next());
  return {
    name,
    quality,
    hired: season - Math.floor(rng.next() * 5),
    salary: staffSalary(quality, salary),
  };
}

/** Seasons left on a coach's current deal, this one included (deals renew while he keeps the job). */
export const coachSeasonsLeft = (coach: CoachProfile, season: number) =>
  coach.years - ((((season - coach.hired) % coach.years) + coach.years) % coach.years);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Market size, a multiplier on market-driven revenue: from a small town to a big city. */
const MARKET = { min: 0.65, max: 1.75 };

/** A team's owner, derived from the team id so old saves and roster files need nothing stored. */
export function ownerOf(team: Team): OwnerProfile {
  const rng = new Rng(hash(`owner:${team.id}`));
  return {
    name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
    priority: round2(rng.next()),
    patience: round2(rng.next()),
    budget: round2(rng.next()),
  };
}

/** A team's arena: seats between `range.min` and `range.max`, derived from the team id. */
export const capacityOf = (team: Team, range: { min: number; max: number }): number =>
  Math.round(range.min + new Rng(hash(`arena:${team.id}`)).next() * (range.max - range.min));

/** A team's ticket price step: set by its GM, else the owner's (profit owners charge more). */
export const ticketPctOf = (team: Team, set: Record<string, number>): number =>
  set[team.id] ?? (ownerOf(team).priority < 1 / 3 ? 10 : ownerOf(team).priority > 2 / 3 ? -10 : 0);

/**
 * A team's market size (0.65-1.75), derived from the team id. Squared, so most teams are small or
 * mid-market and a few are big cities (mean about 1): the balance lab's revenue spread and mean.
 */
export const marketOf = (team: Team): number =>
  round2(MARKET.min + new Rng(hash(`market:${team.id}`)).next() ** 2 * (MARKET.max - MARKET.min));
