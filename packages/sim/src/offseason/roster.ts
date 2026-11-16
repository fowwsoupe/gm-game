import type { Contract, Player, TeamId } from '@gm/shared';
import type { LeagueState } from '../core';
import { elcYears, maxPlayerCapHit, payroll, validateContract, type Ruleset } from '../cba';
import { marketSalary } from '../value';

/** Players in a stable order (by id), so every step is reproducible whatever the key order. */
export const allPlayers = (state: LeagueState): Player[] =>
  Object.values(state.players).sort((a, b) => a.id.localeCompare(b.id));

export const rosterOf = (state: LeagueState, teamId: TeamId): Player[] =>
  allPlayers(state).filter((p) => p.teamId === teamId);

export const freeAgents = (state: LeagueState): Player[] =>
  allPlayers(state).filter((p) => p.teamId === null);

export const countAt = (roster: readonly Player[], position: string): number =>
  roster.filter((p) => p.position === position).length;

/** Players a team still has to add to reach the position minimums and the roster minimum. */
export function openSlots(rules: Ruleset, roster: readonly Player[]): number {
  let short = 0;
  for (const [position, min] of Object.entries(rules.roster.positionMin)) {
    short += Math.max(0, min - countAt(roster, position));
  }
  return Math.max(short, rules.roster.minActive - roster.length);
}

/** First position the team is below its minimum at, or null. */
export function neededPosition(rules: Ruleset, roster: readonly Player[]): string | null {
  for (const [position, min] of Object.entries(rules.roster.positionMin)) {
    if (countAt(roster, position) < min) return position;
  }
  return null;
}

/**
 * The most a team can pay `player` per year and still be cap-legal, with a league-minimum
 * salary kept free for every slot it must still fill. Negative = cannot afford him at all.
 */
export function capRoom(rules: Ruleset, roster: readonly Player[], player: Player): number {
  const slots = openSlots(rules, [...roster, player]);
  return rules.cap.upperLimit - payroll(roster) - slots * rules.cap.minSalary;
}

/** Age in the season being prepared (`season` = the new season). */
export const ageIn = (player: Player, season: number) => season - player.birthYear;

/**
 * A legal contract starting in `season`, or null if the team cannot afford one.
 * `discount`: the player accepts less than his asking price when the team is short of room.
 * TODO(M5): negotiation, term preferences, bonuses.
 */
export function offerContract(
  rules: Ruleset,
  roster: readonly Player[],
  player: Player,
  season: number,
  years: number,
  opts: { isResign: boolean; discount: boolean; atLeast?: number },
): Contract | null {
  const ask = Math.max(marketSalary(rules, player), opts.atLeast ?? 0);
  const room = capRoom(rules, roster, player);
  const price = Math.min(ask, maxPlayerCapHit(rules), opts.discount ? room : ask);
  if (price < rules.cap.minSalary || price > room) return null;
  return legal(rules, player, season, years, price, opts.isResign);
}

/**
 * Entry-level deal for a young player: the ruleset's entry-level salary, or whatever the team
 * has room for (never below the league minimum). Null if the age has no ELC or no room at all.
 */
export function entryContract(
  rules: Ruleset,
  roster: readonly Player[],
  player: Player,
  season: number,
): Contract | null {
  const years = elcYears(rules, ageIn(player, season));
  const price = Math.min(rules.contracts.elcSalary, capRoom(rules, roster, player));
  if (years === null || price < rules.cap.minSalary) return null;
  return legal(rules, player, season, years, price, false, true);
}

function legal(
  rules: Ruleset,
  player: Player,
  season: number,
  years: number,
  price: number,
  isResign: boolean,
  elc = false,
): Contract | null {
  const maxYears = isResign ? rules.contracts.maxYearsResign : rules.contracts.maxYearsNewTeam;
  const length = Math.max(1, Math.min(years, maxYears));
  const issues = validateContract(rules, {
    salaries: Array<number>(length).fill(price),
    signingAge: ageIn(player, season),
    isResign,
    elc,
  });
  return issues.length === 0 ? { capHit: price, expiresAfterSeason: season + length - 1 } : null;
}
