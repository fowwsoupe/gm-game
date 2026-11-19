import type { DraftClock, DraftProspect, Player, Team, TeamId, TradeProposal } from '@gm/shared';
import { Rng, teamName, type Emit, type LeagueState } from '../core';
import type { SimContext } from '../context';
import { deadCap } from '../cba';
import { draftPicks, draftSlot, pickLabel, worstFirst } from '../league';
import { evaluateTrade, newTradeCache } from '../trades';
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

/** The live draft's picks still to make, the one on the clock first; empty when no draft is under way. */
export function picksLeft(state: LeagueState, ctx: SimContext): DraftClock[] {
  const first = onTheClock(state, ctx);
  if (!first) return [];
  const order = worstFirst(state, ctx.ruleset);
  return Array.from({ length: order.length * ctx.ruleset.draft.rounds - first.pick + 1 }, (_, i) =>
    draftSlot(state, order, first.pick - 1 + i),
  );
}

/** A team trades up only for a player its scouts read this much above the best it expects at its own pick. */
const TRADE_UP_GAP = 5;
/** ...and from at most this many picks back. */
const TRADE_UP_REACH = 8;

/**
 * A draft-day call for the pick on the clock: the nearest AI team behind it (within reach) whose
 * scouts read the best player left `TRADE_UP_GAP` above the best they expect at their own next
 * pick (the picks in between going by the public order) offers that pick, plus its cheapest other
 * pick when it takes one, for a deal the holder wins as an AI GM judges it (`evaluateTrade`), so
 * a human holder is only called with a deal worth taking.
 * ponytail: one extra pick at most, whatever the gap; a price tied to the gap if calls feel cheap.
 */
export function tradeUpCall(
  state: LeagueState,
  ctx: SimContext,
  clock: DraftClock,
  order: readonly TeamId[],
): TradeProposal | null {
  const pool = state.draftClass;
  const season = state.date.season + 1;
  const best = (team: Team, from: number) =>
    Math.max(
      ...pool.slice(from, from + AI_LOOKS_AT).map((d) => {
        const r = teamRange(team, d, ctx, season);
        return (r.low + r.high) / 2;
      }),
    );
  const holder = state.teams[clock.teamId]!;
  const judge = {
    ...state,
    teams: { ...state.teams, [holder.id]: { ...holder, userControlled: false } },
  };
  const cache = newTradeCache();
  const seen = new Set<TeamId>([holder.id]);
  const last = Math.min(order.length * ctx.ruleset.draft.rounds, clock.pick + TRADE_UP_REACH);
  for (let at = clock.pick; at < last; at++) {
    const next = draftSlot(state, order, at);
    const caller = state.teams[next.teamId]!;
    if (seen.has(caller.id)) continue;
    seen.add(caller.id);
    if (caller.userControlled || best(caller, 0) - best(caller, at - clock.pick + 1) < TRADE_UP_GAP)
      continue;
    const extras = draftPicks(state, ctx.ruleset, caller.id)
      .filter((p) => p.id !== next.id)
      .sort((a, b) => b.season - a.season || b.round - a.round); // cheapest first
    for (const extra of [[], ...extras.map((p) => [p.id])]) {
      const call: TradeProposal = {
        fromTeamId: caller.id,
        toTeamId: holder.id,
        give: [],
        get: [],
        givePicks: [next.id, ...extra],
        getPicks: [clock.id],
      };
      if (evaluateTrade(judge, ctx, call, cache).accepted) return call;
    }
  }
  return null;
}

/**
 * The live draft from the pick on the clock until every pick is made or, with `stopForHumans`, a
 * human team is on the clock. Each team takes the first player still on its board, else (AI) the
 * best its scouts read, else (human) the best scouted one left. Live, a team behind may call to
 * trade up (`tradeUpCall`) before each pick: an AI team takes the deal, a human gets the offer,
 * open while the pick is on the clock.
 */
export function draftUntil(
  state: LeagueState,
  ctx: SimContext,
  emit: Emit,
  stopForHumans: boolean,
) {
  const order = worstFirst(state, ctx.ruleset);
  let traded = 0; // one trade per pick
  for (let clock = onTheClock(state, ctx, order); clock; clock = onTheClock(state, ctx, order)) {
    const team = state.teams[clock.teamId]!;
    if (stopForHumans && team.userControlled) {
      const open = state.tradeOffers.some((o) => o.proposal.getPicks?.includes(clock!.id));
      const call = open ? null : tradeUpCall(state, ctx, clock, order);
      if (call) {
        emit('notable', [team.id, call.fromTeamId], {
          kind: 'trade.offered',
          offer: {
            id: `o${state.date.season}_pick${clock.pick}_${team.id}`,
            proposal: call,
            expiresDay: state.date.day,
          },
        });
      }
      return;
    }
    const call = stopForHumans && traded !== clock.pick && tradeUpCall(state, ctx, clock, order);
    if (call) {
      traded = clock.pick;
      emit('major', [call.fromTeamId, team.id], { kind: 'trade.completed', ...call });
      emit('notable', [call.fromTeamId, team.id], {
        kind: 'news.posted',
        headline: 'event.trade',
        params: {
          from: teamName(state.teams[call.fromTeamId]!),
          to: teamName(team),
          give: call.givePicks!.map((id) => pickLabel(state, id)).join(', '),
          get: pickLabel(state, clock.id),
        },
      });
      continue;
    }
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
  // A trade offer for a pick lasts while it is on the clock.
  for (const o of state.tradeOffers) {
    if (![...(o.proposal.givePicks ?? []), ...(o.proposal.getPicks ?? [])].includes(clock.id))
      continue;
    emit('minor', [o.proposal.toTeamId, o.proposal.fromTeamId], {
      kind: 'trade.offerClosed',
      offerId: o.id,
      accepted: false,
    });
  }
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
