import type { DraftProspect, Player, Team, TeamId } from '@gm/shared';
import { teamName, type Emit, type LeagueState, type Rng } from '../core';
import type { SimContext } from '../context';
import { deadCap } from '../cba';
import { pickId, pickOwner } from '../league';
import { seenBy } from '../people';
import { clampRating } from '../players';
import { entryContract, rosterOf } from './roster';

/** How far a scout's read of a prospect's potential is off, on average (rating points). */
const SCOUT_SD = 4;
/** Half the width of the scouted range. */
const SCOUT_HALF_RANGE = 5;

const scouted = (d: DraftProspect) => (d.low + d.high) / 2;

/**
 * An AI GM without a board picks the best potential as his own scouts read it (`seenBy`: a good
 * GM sees close to the truth, a poor one worse than the public range) among the next few.
 */
const AI_LOOKS_AT = 12;
function aiPick(team: Team, pool: readonly DraftProspect[]): number {
  let best = 0;
  let bestRead = -Infinity;
  pool.slice(0, AI_LOOKS_AT).forEach((d, i) => {
    const read = seenBy(team, d.player).potential;
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
 * Step 4: the draft. Round one follows the lottery; later rounds go worst to best. Each team
 * takes the first player still on its board, else the best scouted one left. Drafted players
 * sign an entry-level contract; a pick the team cannot fit under the cap goes to the free-agent
 * pool instead. A league with no announced class (an old save) gets one now.
 * TODO(feature): draft rights and prospects kept off the roster.
 */
export function runDraft(
  state: LeagueState,
  ctx: SimContext,
  rng: Rng,
  emit: Emit,
  season: number,
  /** Teams from worst to best. */
  order: readonly TeamId[],
) {
  // Drawn when the class was announced; an old save without it draws now.
  const firstRound = state.draftOrder.length
    ? state.draftOrder
    : drawLottery(state, ctx, rng.fork('lottery'), emit, order);
  const pool = state.draftClass.length
    ? [...state.draftClass]
    : draftClass(state, ctx, rng.fork('class'));

  for (let i = 0; pool.length > 0 && i < order.length * ctx.ruleset.draft.rounds; i++) {
    const round = Math.floor(i / order.length) + 1;
    const slotTeam = (i < order.length ? firstRound : order)[i % order.length]!;
    const id = pickId(season, round, slotTeam);
    const protection = state.pickProtection[id];
    // A protected pick that lands high stays with the team that traded it.
    const teamId =
      round === 1 && protection && i + 1 <= protection.top
        ? protection.keeper
        : pickOwner(state, id, slotTeam);
    const board = state.draftBoards[teamId] ?? [];
    const team = state.teams[teamId]!;
    const wanted =
      board.map((id) => pool.findIndex((d) => d.player.id === id)).find((at) => at >= 0) ??
      (team.userControlled ? undefined : aiPick(team, pool));
    const [{ player: prospect }] = pool.splice(wanted ?? 0, 1) as [DraftProspect];
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
    emit(i === 0 ? 'notable' : 'minor', [teamId], {
      kind: 'player.drafted',
      player,
      round,
      pick: i + 1,
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
