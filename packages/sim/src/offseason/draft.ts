import type { DraftClock, DraftProspect, Player, Team, TeamId } from '@gm/shared';
import { Rng, teamName, type Emit, type LeagueState } from '../core';
import type { SimContext } from '../context';
import { deadCap } from '../cba';
import { draftSlot, worstFirst } from '../league';
import { hash, staffOf } from '../people';
import { clampRating } from '../players';
import { entryContract, rosterOf } from './roster';

/** How far a scout's read of a prospect's potential is off, on average (rating points). */
const SCOUT_SD = 4;
/** Half the width of the scouted range. */
const SCOUT_HALF_RANGE = 5;

const scouted = (d: DraftProspect) => (d.low + d.high) / 2;

/**
 * A prospect's potential range as this team's scouts read it: a good scouting department reads
 * close to the truth and narrower than the public range, a poor one wider and further off. The
 * read is the same every time for the same department and prospect; nothing is stored.
 */
export function teamRange(
  team: Team,
  d: DraftProspect,
  ctx: SimContext,
  season: number,
): { low: number; high: number } {
  const fo = ctx.ruleset.frontOffice;
  const q = staffOf(team, 'scouting', fo.salary, season).quality;
  const sd = fo.scouting.best + (1 - q) * (fo.scouting.worst - fo.scouting.best);
  const read =
    d.player.potential + new Rng(hash(`draftRead:${team.id}:${q}:${d.player.id}`)).normal(0, sd);
  const half = (SCOUT_HALF_RANGE * sd) / SCOUT_SD;
  return { low: clampRating(read - half), high: clampRating(read + half) };
}

/** An AI GM without a board picks the best potential as his scouts read it among the next few. */
const AI_LOOKS_AT = 12;
function aiPick(team: Team, pool: readonly DraftProspect[], ctx: SimContext, season: number) {
  let best = 0;
  let bestRead = -Infinity;
  pool.slice(0, AI_LOOKS_AT).forEach((d, i) => {
    const r = teamRange(team, d, ctx, season);
    const read = (r.low + r.high) / 2;
    if (read > bestRead) [best, bestRead] = [i, read];
  });
  return best;
}

/**
 * Next season's draft class with its scouted ranges, best scouted first. Every team sees the
 * same range; the true potential stays hidden, so some picks bust and some go late and boom.
 */
export function draftClass(state: LeagueState, ctx: SimContext, rng: Rng): DraftProspect[] {
  const season = state.date.season + 1;
  const count = Object.keys(state.teams).length * ctx.ruleset.draft.rounds;
  return Array.from({ length: count }, (_, i) => {
    const player = ctx.sport.generateProspect(rng, { id: `d${season}_${i}`, season });
    const read = player.potential + rng.normal(0, SCOUT_SD);
    return {
      player,
      low: clampRating(read - SCOUT_HALF_RANGE),
      high: clampRating(read + SCOUT_HALF_RANGE),
    };
  }).sort((a, b) => scouted(b) - scouted(a) || a.player.id.localeCompare(b.player.id));
}

/** Announces the class once the champion is crowned, so teams can scout and rank it. */
export function announceDraftClass(
  state: LeagueState,
  ctx: SimContext,
  rng: Rng,
  emit: Emit,
  /** Teams from worst to best. */
  order: readonly TeamId[],
) {
  const firstRound = drawLottery(state, ctx, rng.fork('lottery'), emit, order);
  emit('notable', [], {
    kind: 'draft.classAnnounced',
    prospects: draftClass(state, ctx, rng),
    firstRound,
  });
}

/** Draws round one (the lottery), with news when a team jumps to the top. */
function drawLottery(
  state: LeagueState,
  ctx: SimContext,
  rng: Rng,
  emit: Emit,
  order: readonly TeamId[],
): TeamId[] {
  const { lottery } = ctx.ruleset.draft;
  const firstRound = lotteryOrder(
    order,
    lottery,
    order.length - ctx.ruleset.playoffs.teamsQualifying,
    rng,
  );
  if (lottery && firstRound[0] !== order[0] && firstRound[0]) {
    const team = state.teams[firstRound[0]]!;
    emit('notable', [team.id], {
      kind: 'news.posted',
      headline: 'event.lotteryWon',
      params: { team: teamName(team) },
    });
  }
  return firstRound;
}

/**
 * Step 4 opens the draft: the lottery and class were drawn when the class was announced; an old
 * save without them draws them now.
 */
export function openDraft(
  state: LeagueState,
  ctx: SimContext,
  rng: Rng,
  emit: Emit,
  /** Teams from worst to best. */
  order: readonly TeamId[],
) {
  if (!state.draftClass.length || !state.draftOrder.length) {
    const prospects = state.draftClass.length
      ? state.draftClass
      : draftClass(state, ctx, rng.fork('class'));
    const firstRound = drawLottery(state, ctx, rng.fork('lottery'), emit, order);
    emit('notable', [], { kind: 'draft.classAnnounced', prospects, firstRound });
  }
  emit('minor', [], { kind: 'draft.started' });
}

/** The pick on the clock in the live draft; null when no draft is under way or every pick is made. */
export function onTheClock(
  state: LeagueState,
  ctx: SimContext,
  order: readonly TeamId[] = worstFirst(state, ctx.ruleset),
): DraftClock | null {
  const made = state.draftPicksMade;
  if (made === null || !state.draftClass.length || made >= order.length * ctx.ruleset.draft.rounds)
    return null;
  return draftSlot(state, order, made);
}

/**
 * The live draft from the pick on the clock until every pick is made or, with `stopForHumans`, a
 * human team is on the clock. Each team takes the first player still on its board, else (AI) the
 * best its scouts read, else (human) the best scouted one left.
 */
export function draftUntil(
  state: LeagueState,
  ctx: SimContext,
  emit: Emit,
  stopForHumans: boolean,
) {
  const order = worstFirst(state, ctx.ruleset);
  for (let clock = onTheClock(state, ctx, order); clock; clock = onTheClock(state, ctx, order)) {
    const team = state.teams[clock.teamId]!;
    if (stopForHumans && team.userControlled) return;
    const pool = state.draftClass;
    const wanted =
      (state.draftBoards[team.id] ?? [])
        .map((id) => pool.findIndex((d) => d.player.id === id))
        .find((at) => at >= 0) ??
      (team.userControlled ? 0 : aiPick(team, pool, ctx, state.date.season + 1));
    draftPlayer(state, ctx, emit, clock, pool[wanted]!.player.id);
  }
}

/**
 * `clock`'s team drafts `playerId`, who signs an entry-level contract; a pick the team cannot fit
 * under the cap goes to the free-agent pool instead.
 * TODO(feature): draft rights and prospects kept off the roster.
 */
export function draftPlayer(
  state: LeagueState,
  ctx: SimContext,
  emit: Emit,
  clock: DraftClock,
  playerId: string,
) {
  const season = state.date.season + 1;
  const { teamId, round, pick } = clock;
  const prospect = state.draftClass.find((d) => d.player.id === playerId)!.player;
  const contract = entryContract(
    ctx.ruleset,
    rosterOf(state, teamId),
    prospect,
    season,
    deadCap(state, teamId, season),
  );
  // First-rounders sign with the most the rules allow in performance bonuses.
  const player: Player = contract
    ? {
        ...prospect,
        teamId,
        contract:
          round === 1
            ? { ...contract, perfBonus: ctx.ruleset.contracts.maxPerformanceBonus }
            : contract,
      }
    : prospect;
  emit(pick === 1 ? 'notable' : 'minor', [teamId], { kind: 'player.drafted', player, round, pick });
}

/**
 * Round-one order: the worst `poolSize` teams (at most one per entry in the odds) hold a lottery;
 * each draw picks one at random, weighted by its odds, to pick next. Everyone else keeps their place.
 */
export function lotteryOrder(
  order: readonly TeamId[],
  rule: { draws: number; odds: readonly number[] } | null,
  poolSize: number,
  rng: Rng,
): TeamId[] {
  if (!rule) return [...order];
  const pool = order
    .slice(0, Math.max(0, Math.min(poolSize, rule.odds.length)))
    .map((id, i) => ({ id, weight: rule.odds[i]! }));
  const winners: TeamId[] = [];
  for (let d = 0; d < rule.draws && pool.length > 0; d++) {
    let roll = rng.next() * pool.reduce((sum, t) => sum + t.weight, 0);
    const at = Math.max(
      0,
      pool.findIndex((t) => (roll -= t.weight) < 0),
    );
    winners.push(pool.splice(at, 1)[0]!.id);
  }
  return [...winners, ...pool.map((t) => t.id), ...order.slice(winners.length + pool.length)];
}
