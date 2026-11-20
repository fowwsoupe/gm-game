import type { Player, PlayerId, TeamId, TeamStatus } from '@gm/shared';
import {
  capYearOf,
  playerName,
  prospectsOf,
  teamName,
  type CalendarConfig,
  type Emit,
  type LeagueState,
  type Rng,
} from '../core';
import type { SimContext } from '../context';
import {
  assistantTakes,
  cachedContext,
  evaluateTrade,
  newTradeCache,
  signedProspect,
  tradeWindowOpen,
  type TradeCache,
} from './evaluate';
import { draftPicks, pickLabel } from '../league';
import { overall } from '../players';
import { GM_LEAN, gmOf, planStatus, seenBy } from '../people';

/** Chance the league makes a trade in a given week (when a deal both sides like exists). */
const WEEKLY_TRADE_CHANCE = 0.8;
/** Pairs of teams tried per week. */
const PAIRS_TRIED = 12;
/** Of those, the first ones a buyer spends on teams with players on the trade block. */
const BLOCK_PAIRS = 6;
/** The buyer's own players it considers sending back, cheapest-to-it first. */
const OFFERS_TRIED = 8;

/** Deadline week: its last days, up to and including the deadline, when AI GMs talk every day. */
const DEADLINE_WEEK = 7;
export const inDeadlineWeek = (cal: CalendarConfig, day: number) =>
  day > cal.tradeDeadlineDay - DEADLINE_WEEK && day <= cal.tradeDeadlineDay;

const BUYING: readonly TeamStatus[] = ['contender', 'buyer'];
const SELLING: readonly TeamStatus[] = ['seller', 'rebuilder', 'crisis'];

/** A team's players, by id. */
const roster = (state: LeagueState, id: TeamId) =>
  Object.values(state.players)
    .filter((p) => p.teamId === id)
    .sort((a, b) => a.id.localeCompare(b.id));

/**
 * Player values for one week's trade talks, memoized: contexts scan the whole league and values
 * run the valuator, so each is computed once per player and team.
 */
function valuer(state: LeagueState, ctx: SimContext, cache: TradeCache) {
  const values = new Map<string, number>();
  return (p: Player, teamId: TeamId) => {
    const key = `${p.id}@${teamId}`;
    let v = values.get(key);
    if (v === undefined) {
      const team = cachedContext(state, ctx, teamId, cache);
      v = ctx.models.valuation.value(seenBy(state.teams[teamId]!, p), team, ctx.ruleset).surplus;
      values.set(key, v);
    }
    return v;
  };
}

/**
 * AI GMs trade with each other: a buyer looks at a seller's roster for the player it values
 * most above what the seller does, and offers one of its own players the seller values more
 * than it does (or a draft pick, then a prospect, when no player works). The trade happens only
 * if both sides accept under the same rules as a human offer (`evaluateTrade`), so the AI cannot
 * make a trade a human could not.
 * Players on an AI team's trade block (a fire sale) come first: buyers call those teams first
 * and ask only for listed players. One trade a call at most: weekly, and daily in deadline week.
 * Human teams are never involved.
 */
export function aiTrades(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  if (!tradeWindowOpen(state, ctx) || !rng.chance(WEEKLY_TRADE_CHANCE)) return;
  const ai = Object.values(state.teams)
    .filter((t) => !t.userControlled)
    .map((t) => t.id)
    .sort();
  // An AI team acts on its plan over today's standings (a rebuilder sells even when winning).
  const status = (id: TeamId) => planStatus(state.teams[id]!, state.teamStatus[id] ?? 'bubble');
  // A team on the bubble goes the way its GM leans: a win-now GM buys, a builder sells.
  const lean = (id: TeamId) => GM_LEAN[gmOf(state.teams[id]!).style];
  const buys = (id: TeamId) =>
    BUYING.includes(status(id)) || (status(id) === 'bubble' && lean(id) > 0);
  const sells = (id: TeamId) =>
    SELLING.includes(status(id)) || (status(id) === 'bubble' && lean(id) < 0);
  // A team with players on the trade block is a willing seller of them, whatever its status.
  const blocks = ai.filter((id) => state.tradeBlock.some((p) => state.players[p]?.teamId === id));
  const buyers = ai.filter(buys);
  const sellers = ai.filter((id) => sells(id) || blocks.includes(id));
  if (!buyers.length || !sellers.length) return;
  const cache = newTradeCache();
  const value = valuer(state, ctx, cache);

  for (let i = 0; i < PAIRS_TRIED; i++) {
    const buyer = rng.pick(buyers);
    // Buyers look at the block first: the first calls go to teams with listed players.
    const seller = i < BLOCK_PAIRS && blocks.length ? rng.pick(blocks) : rng.pick(sellers);
    const gap = (p: Player, to: TeamId, from: TeamId) => value(p, to) - value(p, from);
    const listed = roster(state, seller).filter((p) => state.tradeBlock.includes(p.id));
    const target = (listed.length ? listed : roster(state, seller)).sort(
      (a, b) => gap(b, buyer, seller) - gap(a, buyer, seller),
    )[0];
    if (!target) continue;
    // What the buyer can pay with: players the seller values more than it does, then its picks,
    // then its prospects the seller values more (as the entry deal each would sign).
    const wanted = (p: Player) => gap(p, seller, buyer) > 0;
    const byGap = (a: Player, b: Player) => gap(b, seller, buyer) - gap(a, seller, buyer);
    const offers: {
      give: PlayerId[];
      givePicks: string[];
      prospects: PlayerId[];
      label: string;
    }[] = [
      ...roster(state, buyer)
        .filter(wanted)
        .sort(byGap)
        .slice(0, OFFERS_TRIED)
        .map((p) => ({ give: [p.id], givePicks: [], prospects: [], label: playerName(p) })),
      ...draftPicks(state, ctx.ruleset, buyer)
        .sort((a, b) => b.season - a.season || b.round - a.round) // cheapest first
        .slice(0, OFFERS_TRIED)
        .map((pk) => ({
          give: [],
          givePicks: [pk.id],
          prospects: [],
          label: pickLabel(state, pk.id),
        })),
      ...prospectsOf(state, buyer)
        .map((pr) => signedProspect(ctx.ruleset, pr, capYearOf(state)))
        .filter(wanted)
        .sort(byGap)
        .slice(0, OFFERS_TRIED)
        .map((p) => ({ give: [], givePicks: [], prospects: [p.id], label: playerName(p) })),
    ];
    for (const offer of offers) {
      const get = [target.id];
      const sellerSays = evaluateTrade(
        state,
        ctx,
        {
          fromTeamId: buyer,
          toTeamId: seller,
          give: offer.give,
          get,
          givePicks: offer.givePicks,
          giveProspects: offer.prospects,
        },
        cache,
      );
      if (!sellerSays.accepted) continue;
      const buyerSays = evaluateTrade(
        state,
        ctx,
        {
          fromTeamId: seller,
          toTeamId: buyer,
          give: get,
          get: offer.give,
          getPicks: offer.givePicks,
          getProspects: offer.prospects,
        },
        cache,
      );
      if (!buyerSays.accepted) continue;
      emit('major', [buyer, seller], {
        kind: 'trade.completed',
        fromTeamId: buyer,
        toTeamId: seller,
        give: offer.give,
        get,
        ...(offer.givePicks.length && { givePicks: offer.givePicks }),
        ...(offer.prospects.length && { giveProspects: offer.prospects }),
      });
      emit('notable', [buyer, seller], {
        kind: 'news.posted',
        headline: 'event.trade',
        params: {
          from: teamName(state.teams[buyer]!),
          to: teamName(state.teams[seller]!),
          give: offer.label,
          get: playerName(target),
        },
      });
      return;
    }
  }
}

/** Chance an AI GM calls a human team in a given week. */
const WEEKLY_OFFER_CHANCE = 0.35;
/** With a player on the trade block, a team calls this much more often (and asks for him). */
const BLOCK_OFFER_CHANCE = 0.7;
/** Days an offer stays open. */
const OFFER_DAYS = 7;

/** The last day an offer made today stays open: a week on, or the trade deadline if sooner. */
export function offerExpires(state: LeagueState, ctx: SimContext): number {
  const { day } = state.date;
  const deadline = ctx.ruleset.season.calendar.tradeDeadlineDay;
  return state.championTeamId ? day + OFFER_DAYS : Math.min(day + OFFER_DAYS, deadline);
}

/**
 * AI GMs make offers to human teams: one AI team picks the human's player it values most above
 * what he is worth to his own team, and offers a player of its own the human team should value
 * at least as much (by the same valuator, from the human team's situation). The AI must accept
 * its own offer under `evaluateTrade`. One open offer per human team; offers expire after a week,
 * or at the trade deadline if that comes first (none is made on deadline day itself).
 */
export function aiOffers(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  for (const o of state.tradeOffers.filter((x) => x.expiresDay <= state.date.day)) {
    emit('minor', [o.proposal.toTeamId, o.proposal.fromTeamId], {
      kind: 'trade.offerClosed',
      offerId: o.id,
      accepted: false,
    });
  }
  const { day } = state.date;
  const expiresDay = offerExpires(state, ctx);
  if (!tradeWindowOpen(state, ctx) || expiresDay <= day) return;
  const teams = Object.values(state.teams).sort((a, b) => a.id.localeCompare(b.id));
  const ai = teams.filter((t) => !t.userControlled).map((t) => t.id);
  if (!ai.length) return;
  const cache = newTradeCache();
  const value = valuer(state, ctx, cache);
  for (const human of teams.filter((t) => t.userControlled).map((t) => t.id)) {
    if (state.tradeOffers.some((o) => o.proposal.toTeamId === human)) continue;
    const listed = roster(state, human).filter((p) => state.tradeBlock.includes(p.id));
    if (!rng.chance(listed.length ? BLOCK_OFFER_CHANCE : WEEKLY_OFFER_CHANCE)) continue;
    const caller = rng.pick(ai);
    const gap = (p: Player, to: TeamId, from: TeamId) => value(p, to) - value(p, from);
    const target = (listed.length ? listed : roster(state, human)).sort(
      (a, b) => gap(b, caller, human) - gap(a, caller, human),
    )[0];
    if (!target) continue;
    const offer = roster(state, caller)
      .filter((p) => value(p, human) >= value(target, human))
      .sort((a, b) => gap(b, human, caller) - gap(a, human, caller))
      .find(
        (p) =>
          evaluateTrade(
            state,
            ctx,
            {
              fromTeamId: human,
              toTeamId: caller,
              give: [target.id],
              get: [p.id],
            },
            cache,
          ).accepted,
      );
    if (!offer) continue;
    emit('notable', [human, caller], {
      kind: 'trade.offered',
      offer: {
        id: `o${state.date.season}_${day}_${human}`,
        proposal: { fromTeamId: caller, toTeamId: human, give: [offer.id], get: [target.id] },
        expiresDay,
      },
    });
  }
}

/**
 * Delegated chore: a human team that handed its offers over has its assistant GM turn down the
 * ones he advises against, on his read (so a poor one lets bad offers through and refuses good
 * ones). Taking an offer stays yours.
 */
export function delegatedOffers(state: LeagueState, ctx: SimContext, emit: Emit): void {
  for (const o of state.tradeOffers.filter((x) => state.delegated[x.proposal.toTeamId])) {
    if (assistantTakes(state, ctx, o.proposal) !== false) continue;
    emit('minor', [o.proposal.toTeamId, o.proposal.fromTeamId], {
      kind: 'trade.offerClosed',
      offerId: o.id,
      accepted: false,
    });
  }
}

/**
 * Deadline day's recap in the feed: the trades of deadline week, and the biggest buyer (the team
 * whose incoming players' overall most beats its outgoing players').
 */
export function deadlineRecap(state: LeagueState, ctx: SimContext, emit: Emit): void {
  const cal = ctx.ruleset.season.calendar;
  const week = state.seasonTrades.filter((t) => inDeadlineWeek(cal, t.day));
  const added = new Map<TeamId, number>();
  const move = (ids: readonly PlayerId[], to: TeamId, from: TeamId) => {
    for (const id of ids) {
      const p = state.players[id];
      if (!p) continue;
      added.set(to, (added.get(to) ?? 0) + overall(p));
      added.set(from, (added.get(from) ?? 0) - overall(p));
    }
  };
  for (const t of week) {
    move(t.give, t.toTeamId, t.fromTeamId);
    move(t.get, t.fromTeamId, t.toTeamId);
  }
  const buyer = [...added].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  emit('notable', buyer ? [buyer] : [], {
    kind: 'news.posted',
    ...(buyer
      ? {
          headline: 'event.deadlineRecap',
          params: { n: week.length, team: teamName(state.teams[buyer]!) },
        }
      : { headline: 'event.deadlineQuiet', params: { n: week.length } }),
  });
}
