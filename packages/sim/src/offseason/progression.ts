import type { Player } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import type { DevelopmentModel } from '../players';
import { ageIn, allPlayers } from './roster';
import { staffOf } from '../people';
import type { SimContext } from '../context';
import { clampRating, overall } from '../players';
import { playerName, teamName } from '../core';

const sameRatings = (a: Player, b: Player) =>
  a.potential === b.potential && Object.keys(a.ratings).every((k) => a.ratings[k] === b.ratings[k]);

/** How much of the development staff's effect reaches a player by age: all of it to 24, half from 30. */
const orgReach = (age: number) => (age <= 24 ? 1 : age >= 30 ? 0.5 : 1 - (age - 24) / 12);

/**
 * Step 1: every player (free agents too) ages a year and develops, in one event. Players on a team
 * also get its development staff's effect: up to `frontOffice.development.points` a year from the
 * best department, against the league's average one.
 */
export function developPlayers(
  state: LeagueState,
  ctx: SimContext,
  rng: Rng,
  emit: Emit,
  season: number,
) {
  const model = ctx.models.development;
  const fo = ctx.ruleset.frontOffice;
  const changes: { playerId: Player['id']; ratings: Record<string, number>; potential: number }[] =
    [];
  const orgRng = rng.fork('organization');
  // Measured against the league's average department, so staff move talent between teams and do
  // not raise the league as a whole.
  const quality = new Map(
    Object.values(state.teams).map((t) => [
      t.id,
      staffOf(t, 'development', fo.salary, season).quality,
    ]),
  );
  const avg = quality.size ? [...quality.values()].reduce((a, b) => a + b, 0) / quality.size : 0.5;
  for (const p of allPlayers(state)) {
    const age = ageIn(p, season);
    let next = model.developOneYear(p, age, rng);
    const q = p.teamId ? quality.get(p.teamId) : undefined;
    if (q !== undefined) {
      const effect = (q - avg) * 2 * fo.development.points * orgReach(age);
      // Whole points, rounded up or down at random so the average effect is exact.
      const whole =
        Math.floor(effect) + (orgRng.fork(p.id).chance(effect - Math.floor(effect)) ? 1 : 0);
      if (whole !== 0) {
        const ratings: Record<string, number> = {};
        for (const [k, v] of Object.entries(next.ratings)) ratings[k] = clampRating(v + whole);
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

/** A player this young or younger whose overall jumps this much in one summer has broken out. */
const BREAKOUT_AGE = 23;
const BREAKOUT_GAIN = 7;

/**
 * Step 1b: news for players on a team who broke out this summer (docs/research/2026-11-league-events.md).
 * `before` is each player's overall before development. Yours make the feed; the league's stay in the log.
 */
export function breakoutNews(
  state: LeagueState,
  before: ReadonlyMap<string, number>,
  emit: Emit,
  season: number,
) {
  for (const p of allPlayers(state)) {
    const was = before.get(p.id);
    const team = p.teamId ? state.teams[p.teamId] : undefined;
    if (!team || was === undefined || ageIn(p, season) > BREAKOUT_AGE) continue;
    const gain = Math.round(overall(p) - was);
    if (gain < BREAKOUT_GAIN) continue;
    emit(team.userControlled ? 'notable' : 'minor', [team.id], {
      kind: 'news.posted',
      headline: 'event.breakout',
      params: { player: playerName(p), team: teamName(team), n: gain },
    });
  }
}
