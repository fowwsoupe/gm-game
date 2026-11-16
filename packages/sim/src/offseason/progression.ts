import type { Player } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import type { DevelopmentModel } from '../players';
import { ageIn, allPlayers } from './roster';
import { gmOf } from '../people';

const sameRatings = (a: Player, b: Player) =>
  a.potential === b.potential && Object.keys(a.ratings).every((k) => a.ratings[k] === b.ratings[k]);

/**
 * Rating points a year the best organization adds to a young player's development, and the worst
 * takes away, against an average one (GM skill stands for the whole front office: scouting, coaching, development staff).
 */
const ORG_DEVELOPMENT = 2;
/** How much of that reaches a player by age: all of it to 24, half from 30 (a slower decline). */
const orgReach = (age: number) => (age <= 24 ? 1 : age >= 30 ? 0.5 : 1 - (age - 24) / 12);

/**
 * Step 1: every player (free agents too) ages a year and develops, in one event. Players on AI
 * teams also get their organization's effect (`ORG_DEVELOPMENT`); human teams get none.
 */
export function developPlayers(
  state: LeagueState,
  model: DevelopmentModel,
  rng: Rng,
  emit: Emit,
  season: number,
) {
  const changes: { playerId: Player['id']; ratings: Record<string, number>; potential: number }[] =
    [];
  const orgRng = rng.fork('organization');
  // Measured against the league's average AI GM, so organizations move talent between teams and
  // do not raise the league as a whole.
  const ai = Object.values(state.teams).filter((t) => !t.userControlled);
  const avgSkill = ai.length ? ai.reduce((s, t) => s + gmOf(t).skill, 0) / ai.length : 0.5;
  for (const p of allPlayers(state)) {
    const age = ageIn(p, season);
    let next = model.developOneYear(p, age, rng);
    const team = p.teamId ? state.teams[p.teamId] : undefined;
    if (team && !team.userControlled) {
      const effect = (gmOf(team).skill - avgSkill) * 2 * ORG_DEVELOPMENT * orgReach(age);
      // Whole points, rounded up or down at random so the average effect is exact.
      const whole =
        Math.floor(effect) + (orgRng.fork(p.id).chance(effect - Math.floor(effect)) ? 1 : 0);
      if (whole !== 0) {
        const ratings: Record<string, number> = {};
        for (const [k, v] of Object.entries(next.ratings))
          ratings[k] = Math.max(1, Math.min(99, v + whole));
        next = { ...next, ratings };
      }
    }
    if (!sameRatings(p, next)) {
      changes.push({ playerId: p.id, ratings: next.ratings, potential: next.potential });
    }
  }
  if (changes.length) emit('minor', [], { kind: 'players.developed', changes });
}

/** Step 2: older and weaker players retire. Free agents too, so the pool cannot pile up. */
export function retirePlayers(
  state: LeagueState,
  model: DevelopmentModel,
  rng: Rng,
  emit: Emit,
  season: number,
) {
  for (const p of allPlayers(state)) {
    // Always draw, so one player's fate never shifts another's.
    if (rng.chance(model.retirementChance(p, ageIn(p, season)))) {
      emit('minor', p.teamId ? [p.teamId] : [], { kind: 'player.retired', playerId: p.id });
    }
  }
}
