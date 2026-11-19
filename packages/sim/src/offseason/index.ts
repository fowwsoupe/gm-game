/**
 * Offseason engine (shared by all sports): the yearly rollover after the champion is crowned.
 * Owns the order of the steps and each step, every one a plain rule that reads `ctx.ruleset`:
 *   1 development  2 retirements  3 contract expiries  4 draft
 *   5 re-signing  6 free agency  7 reaching the cap floor  8 the international tournament (some
 *   summers)  9 next season's schedule and clock
 * Every change goes out as an event through `emit`, so replays and saves stay identical.
 * The summer runs in two halves so a human GM can shop free agency in between:
 * `openFreeAgency` (steps 1-5), then `finishRollover` (6-9). A human GM can hold the draft live
 * instead (`startDraft`, then his picks); opening free agency drafts for him by his board.
 */
import { Rng, phaseOf, type Emit, type LeagueState } from '../core';
import { drawForm, makeSchedule, worstFirst } from '../league';
import type { SimContext } from '../context';
import { draftUntil, onTheClock, openDraft } from './draft';
import { changeGms, setPlans } from './gms';

export {
  lotteryOrder,
  announceDraftClass,
  teamRange,
  onTheClock,
  picksLeft,
  draftPlayer,
} from './draft';
export { scoutReport } from './scouting';
export { signingInterest, signFreeAgent, sheetCompensation } from './signing';
export { acceptSheet, marketDay, roomFor } from './market';
export { aiHoldouts, resignOffers, resignContract, isExpiring, resignWindowOpen } from './resign';
export { stayChance } from './freeAgency';
export { freeAgents, wantedYears } from './roster';
export { developPlayers, trainFocus } from './progression';
export { playInternational } from './international';
export { changeStaff, staffCandidates, departmentReturns, interimHead } from './staff';
import { expireContracts, fillRosters, meetCapFloor, reSignPlayers } from './freeAgency';
import { MARKET_DAYS, decideOffers, marketDay } from './market';
import { breakoutNews, developPlayers, retirePlayers } from './progression';
import { changeStaff } from './staff';
import { playInternational } from './international';
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
 * Steps 1-4: the summer's first steps, then the draft opens and runs until a human team is on
 * the clock (or, without `stopForHumans`, to the end). Ages are for the season about to start;
 * the date stays in the old season until `finishRollover`.
 */
export function startDraft(
  state: LeagueState,
  ctx: SimContext,
  emit: Emit,
  stopForHumans = true,
): void {
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
  expireContracts(state, ctx, emit);
  openDraft(state, ctx, rng.fork('draft'), emit, order);
  continueDraft(state, ctx, emit, stopForHumans);
}

/** The live draft goes on (see `draftUntil`); once every pick is made, step 5 and free agency opens. */
export function continueDraft(
  state: LeagueState,
  ctx: SimContext,
  emit: Emit,
  stopForHumans: boolean,
): void {
  draftUntil(state, ctx, emit, stopForHumans);
  if (onTheClock(state, ctx)) return;
  const rng = new Rng(state.rngState);
  reSignPlayers(state, ctx, rng.fork('resign'), emit, state.date.season + 1);
  emit('notable', [], { kind: 'freeAgency.opened' });
}

/** First half of the summer (steps 1-5), then free agency opens; a live draft is finished first. */
export function openFreeAgency(state: LeagueState, ctx: SimContext, emit: Emit): void {
  if (state.draftPicksMade === null) startDraft(state, ctx, emit, false);
  else continueDraft(state, ctx, emit, false);
}

/** Second half (steps 6-9): AI teams fill their rosters and reach the floor, then the new season starts. */
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
  playInternational(state, ctx, rng.fork('international'), emit, season);

  // The season opens with camp: no games until day 0.
  const day = -ctx.ruleset.season.calendar.preseasonDays;
  emit('minor', [], {
    kind: 'season.started',
    season,
    day,
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
  emit('major', [], {
    kind: 'season.phaseChanged',
    from,
    to: phaseOf(ctx.ruleset.season.calendar, { season, day }),
  });
}

/** The whole summer at once (free agency is opened first if a human has not done it). */
export function rolloverSeason(state: LeagueState, ctx: SimContext, emit: Emit): void {
  if (!state.freeAgencyOpen) openFreeAgency(state, ctx, emit);
  finishRollover(state, ctx, emit);
}
