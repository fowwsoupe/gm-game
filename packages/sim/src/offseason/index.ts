/**
 * Offseason engine (shared by all sports): the yearly rollover after the champion is crowned.
 * Owns the order of the steps and each step, every one a plain rule that reads `ctx.ruleset`:
 *   1 development  2 retirements  3 contract expiries  4 draft
 *   5 re-signing  6 free agency  7 reaching the cap floor  8 next season's schedule and clock
 * Every change goes out as an event through `emit`, so replays and saves stay identical.
 * AI only for now: user-controlled teams are handled like any other until draft and
 * free-agency screens exist.
 */
import type { TeamId } from '@gm/shared';
import { Rng, phaseOf, type Emit, type LeagueState } from '../core';
import { computeStandings, makeSchedule } from '../league';
import type { SimContext } from '../context';
import { runDraft } from './draft';

export { lotteryOrder } from './draft';
import { expireContracts, fillRosters, meetCapFloor, reSignPlayers } from './freeAgency';
import { developPlayers, retirePlayers } from './progression';

export function rolloverSeason(state: LeagueState, ctx: SimContext, emit: Emit): void {
  const season = state.date.season + 1;
  const rng = new Rng(state.rngState);
  const teamIds = Object.keys(state.teams).sort() as TeamId[];
  const from = phaseOf(ctx.ruleset.season.calendar, state.date);
  // Worst team first, from this season's standings (taken before anything changes).
  const order = computeStandings(teamIds, Object.values(state.results), ctx.ruleset.season.points)
    .map((row) => row.teamId)
    .reverse();

  developPlayers(state, ctx.models.development, rng.fork('development'), emit, season);
  retirePlayers(state, ctx.models.development, rng.fork('retirement'), emit, season);
  const expiring = expireContracts(state, emit);
  runDraft(state, ctx, rng.fork('draft'), emit, season, order);
  reSignPlayers(state, ctx, rng.fork('resign'), emit, season, expiring);
  fillRosters(state, ctx, rng.fork('freeAgency'), emit, season, order);
  meetCapFloor(state, ctx, rng.fork('capFloor'), emit, season, order);

  emit('minor', [], {
    kind: 'season.started',
    season,
    schedule: makeSchedule(
      season,
      Object.values(state.teams).sort((a, b) => a.id.localeCompare(b.id)),
      ctx.ruleset.season.gamesPerTeam,
      ctx.ruleset.season.calendar.regularSeasonDays,
      rng.fork('schedule'),
    ),
    rngState: rng.fork('games').state,
  });
  emit('major', [], { kind: 'season.phaseChanged', from, to: 'regular' });
}
