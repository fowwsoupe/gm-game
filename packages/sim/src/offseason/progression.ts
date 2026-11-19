import type { Player } from '@gm/shared';
import { playerName, teamName, type Emit, type LeagueState, type Rng } from '../core';
import { clampRating, overall, type DevelopmentModel } from '../players';
import { personalityOf, staffOf } from '../people';
import type { SimContext } from '../context';
import { ageIn, allPlayers } from './roster';

const sameRatings = (a: Player, b: Player) =>
  a.potential === b.potential && Object.keys(a.ratings).every((k) => a.ratings[k] === b.ratings[k]);

/** How much of the development staff's effect reaches a player by age: all of it to 24, half from 30. */
const orgReach = (age: number) => (age <= 24 ? 1 : age >= 30 ? 0.5 : 1 - (age - 24) / 12);

/**
 * A summer focus: moves up to `n` whole points, one at a time, onto the lowest focus key still under
 * his potential, each from the next of his other keys in turn (starting at `start`), so his overall
 * holds. Returns the new ratings and the points the focus gained.
 */
export function trainFocus(
  ratings: Readonly<Record<string, number>>,
  focus: readonly string[],
  potential: number,
  n: number,
  start = 0,
) {
  const next = { ...ratings };
  const others = Object.keys(next).filter((k) => !focus.includes(k));
  let gained = 0;
  for (let i = 0; i < n; i++) {
    const to = focus
      .filter((k) => next[k] !== undefined && next[k] < Math.min(potential, 99))
      .sort((a, b) => next[a]! - next[b]!)[0];
    const from = others
      .map((_, j) => others[(start + i + j) % others.length]!)
      .find((k) => next[k]! > 1);
    if (!to || !from) break;
    next[to]!++;
    next[from]!--;
    gained++;
  }
  return { ratings: next, gained };
}

/**
 * Step 1: every player (free agents and prospects too) ages a year and develops, in one event.
 * Players on a team, and prospects, also get its development staff's effect: up to
 * `frontOffice.development.points` a year from the best department, against the league's average.
 * Then a player on a human team with a summer focus (`trainingPlans`) moves `training.points` onto
 * it from his other ratings, scaled by age like the staff and by his professionalism; a focus key
 * at his potential gains nothing.
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
  const trainRng = rng.fork('training');
  const trained: { player: Player; focus: string; gained: number }[] = [];
  // Measured against the league's average department, so staff move talent between teams and do
  // not raise the league as a whole.
  const quality = new Map(
    Object.values(state.teams).map((t) => [
      t.id,
      staffOf(t, 'development', fo.salary, season).quality,
    ]),
  );
  const avg = quality.size ? [...quality.values()].reduce((a, b) => a + b, 0) / quality.size : 0.5;
  // Prospects after the players, so adding them leaves every player's draws as they were.
  const pool = Object.values(state.prospects)
    .map((x) => x.player)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const p of [...allPlayers(state), ...pool]) {
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
    const focus = state.trainingPlans[p.id];
    const keys = focus && ctx.sport.trainingFocus(p.position)[focus];
    if (keys && p.teamId && state.teams[p.teamId]?.userControlled) {
      const share =
        ctx.ruleset.training.points * orgReach(age) * (0.5 + personalityOf(p.id).professionalism);
      const n = Math.floor(share) + (trainRng.fork(p.id).chance(share % 1) ? 1 : 0);
      const done = trainFocus(next.ratings, keys, next.potential, n, season);
      next = { ...next, ratings: done.ratings };
      if (done.gained) trained.push({ player: p, focus, gained: done.gained });
    }
    if (!sameRatings(p, next)) {
      changes.push({ playerId: p.id, ratings: next.ratings, potential: next.potential });
    }
  }
  if (changes.length) emit('minor', [], { kind: 'players.developed', changes });
  for (const { player, focus, gained } of trained) {
    emit('notable', [player.teamId!], {
      kind: 'news.posted',
      headline: 'event.summerTraining',
      playerId: player.id,
      params: { player: playerName(player), focus, n: gained },
    });
  }
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
      playerId: p.id,
      params: { player: playerName(p), team: teamName(team), n: gain },
    });
    if (team.userControlled) {
      emit('minor', [team.id], {
        kind: 'player.brokeOut',
        playerId: p.id,
        teamId: team.id,
        season,
      });
    }
  }
}
