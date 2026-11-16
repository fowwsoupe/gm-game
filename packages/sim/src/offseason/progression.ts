import type { Player } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import type { DevelopmentModel } from '../players';
import { ageIn, allPlayers } from './roster';

const sameRatings = (a: Player, b: Player) =>
  a.potential === b.potential && Object.keys(a.ratings).every((k) => a.ratings[k] === b.ratings[k]);

/** Step 1: every player (free agents too) ages a year and develops, in one event. */
export function developPlayers(
  state: LeagueState,
  model: DevelopmentModel,
  rng: Rng,
  emit: Emit,
  season: number,
) {
  const changes: { playerId: Player['id']; ratings: Record<string, number>; potential: number }[] =
    [];
  for (const p of allPlayers(state)) {
    const next = model.developOneYear(p, ageIn(p, season), rng);
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
