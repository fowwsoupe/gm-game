/**
 * Offseason engine (shared by all sports): the yearly rollover after the champion is crowned.
 * Owns the order of the steps and each step, every one a plain rule that reads `ctx.ruleset`:
 *   1 development  2 retirements  3 contract expiries  4 draft
 *   5 re-signing  6 free agency  7 reaching the cap floor  8 next season's schedule and clock
 * Every change goes out as an event through `emit`, so replays and saves stay identical.
 * The summer runs in two halves so a human GM can shop free agency in between:
 * `openFreeAgency` (steps 1-5), then `finishRollover` (6-8). AI teams draft and fill rosters for
 * human teams too, until the draft screen exists.
 */
import { Rng, phaseOf, type Emit, type LeagueState } from '../core';
import { drawForm, makeSchedule, worstFirst } from '../league';
import type { SimContext } from '../context';
import { runDraft } from './draft';
import { changeGms, setPlans } from './gms';

export { lotteryOrder, announceDraftClass, teamRange } from './draft';
export { scoutReport } from './scouting';
export { signingInterest, signFreeAgent, sheetCompensation } from './signing';
export { acceptSheet, marketDay, roomFor } from './market';
export { aiHoldouts, resignOffers, resignContract, isExpiring, resignWindowOpen } from './resign';
export { stayChance } from './freeAgency';
export { developPlayers } from './progression';
export { changeStaff, staffCandidates, departmentReturns, interimHead } from './staff';
import { expireContracts, fillRosters, meetCapFloor, reSignPlayers } from './freeAgency';
import { MARKET_DAYS, decideOffers, marketDay } from './market';
import { breakoutNews, developPlayers, retirePlayers } from './progression';
import { changeStaff } from './staff';
import { allPlayers } from './roster';
import { overall } from '../players';

/** Step 0: the season's stat lines go to the record books before anyone ages, moves or retires. */
function archiveStats(state: LeagueState, ctx: SimContext, emit: Emit) {
  const lines = ctx.sport.playerLines(
    Object.values(state.results).filter((g) => !g.playoffSeriesId),
  );
  emit('minor', [], {
    kind: 'stats.archived',
    season: state.date.season,
    lines: [...lines]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([id, stats]) => {
        const p = state.players[id];
        return p ? [{ playerId: p.id, teamId: p.teamId, stats }] : [];
      }),
  });
}

/**
 * First half of the summer (steps 1-5), then free agency opens for human GMs. Ages are for the
 * season about to start; the date stays in the old season until `finishRollover`.
 */
export function openFreeAgency(state: LeagueState, ctx: SimContext, emit: Emit): void {
  const season = state.date.season + 1;
  const rng = new Rng(state.rngState);
  const order = worstFirst(state, ctx.ruleset);
  changeGms(state, rng.fork('gms'), emit);
  changeStaff(state, ctx, rng.fork('staff'), emit, season);
  archiveStats(state, ctx, emit);
  const before = new Map(allPlayers(state).map((p) => [p.id, overall(p)]));
  developPlayers(state, ctx, rng.fork('development'), emit, season);
  breakoutNews(state, before, emit, season);
  retirePlayers(state, ctx.models.development, rng.fork('retirement'), emit, season);
  setPlans(state, emit, season);
  const expiring = expireContracts(state, ctx, emit);
  runDraft(state, ctx, rng.fork('draft'), emit, season, order);
  reSignPlayers(state, ctx, rng.fork('resign'), emit, season, expiring);
  emit('notable', [], { kind: 'freeAgency.opened' });
}

/** Second half (steps 6-8): AI teams fill their rosters and reach the floor, then the new season starts. */
export function finishRollover(state: LeagueState, ctx: SimContext, emit: Emit): void {
  const season = state.date.season + 1;
  // Forks do not advance the parent stream, so splitting the summer draws the same numbers.
  const rng = new Rng(state.rngState);
  const order = worstFirst(state, ctx.ruleset);
  const from = phaseOf(ctx.ruleset.season.calendar, state.date);
  // AI teams bid for free agents over a few days; whoever is still short is filled below.
  for (let day = 0; day < MARKET_DAYS; day++) {
    marketDay(state, ctx, rng.fork(`market${day}`), emit);
  }
  decideOffers(state, ctx, emit);
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
    form: drawForm(Object.keys(state.teams), ctx.ruleset.season.form, rng.fork('form')),
  });
  emit('major', [], { kind: 'season.phaseChanged', from, to: 'regular' });
}

/** The whole summer at once (free agency is opened first if a human has not done it). */
export function rolloverSeason(state: LeagueState, ctx: SimContext, emit: Emit): void {
  if (!state.freeAgencyOpen) openFreeAgency(state, ctx, emit);
  finishRollover(state, ctx, emit);
}
