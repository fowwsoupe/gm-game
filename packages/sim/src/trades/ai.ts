import type { Player, TeamId, TeamStatus } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import type { SimContext } from '../context';
import { evaluateTrade, teamContext, tradeWindowOpen } from './evaluate';
import { draftPicks } from '../league';

/** Chance the league makes a trade in a given week (when a deal both sides like exists). */
const WEEKLY_TRADE_CHANCE = 0.8;
/** Pairs of teams tried per week. */
const PAIRS_TRIED = 12;
/** The buyer's own players it considers sending back, cheapest-to-it first. */
const OFFERS_TRIED = 8;

const BUYING: readonly TeamStatus[] = ['contender', 'buyer'];
const SELLING: readonly TeamStatus[] = ['seller', 'rebuilder', 'crisis'];

/**
 * Player values for one week's trade talks, memoized: contexts scan the whole league and values
 * run the valuator, so each is computed once per player and team.
 */
function valuer(state: LeagueState, ctx: SimContext) {
  const contexts = new Map<TeamId, ReturnType<typeof teamContext>>();
  const values = new Map<string, number>();
  return (p: Player, teamId: TeamId) => {
    const key = `${p.id}@${teamId}`;
    let v = values.get(key);
    if (v === undefined) {
      let team = contexts.get(teamId);
      if (!team) contexts.set(teamId, (team = teamContext(state, ctx, teamId)));
      v = ctx.models.valuation.value(p, team, ctx.ruleset).surplus;
      values.set(key, v);
    }
    return v;
  };
}

/**
 * AI GMs trade with each other: a buyer looks at a seller's roster for the player it values
 * most above what the seller does, and offers one of its own players the seller values more
 * than it does (or a draft pick when no player works). The trade happens only if both sides accept under the same rules as a human
 * offer (`evaluateTrade`), so the AI cannot make a trade a human could not.
 * One trade a week at most. Human teams are never involved.
 */
export function aiTrades(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  if (!tradeWindowOpen(state, ctx) || !rng.chance(WEEKLY_TRADE_CHANCE)) return;
  const ai = Object.values(state.teams)
    .filter((t) => !t.userControlled)
    .map((t) => t.id)
    .sort();
  const status = (id: TeamId) => state.teamStatus[id] ?? 'bubble';
  const buyers = ai.filter((id) => BUYING.includes(status(id)));
  const sellers = ai.filter((id) => SELLING.includes(status(id)));
  if (!buyers.length || !sellers.length) return;

  const name = (p: Player) => `${p.firstName} ${p.lastName}`;
  const roster = (id: TeamId) =>
    Object.values(state.players)
      .filter((p) => p.teamId === id)
      .sort((a, b) => a.id.localeCompare(b.id));
  const value = valuer(state, ctx);

  for (let i = 0; i < PAIRS_TRIED; i++) {
    const buyer = rng.pick(buyers);
    const seller = rng.pick(sellers);
    const gap = (p: Player, to: TeamId, from: TeamId) => value(p, to) - value(p, from);
    const target = roster(seller).sort((a, b) => gap(b, buyer, seller) - gap(a, buyer, seller))[0];
    if (!target) continue;
    // What the buyer can pay with: players the seller values more than it does, then its picks.
    const offers: { give: string[]; givePicks: string[]; label: string }[] = [
      ...roster(buyer)
        .filter((p) => gap(p, seller, buyer) > 0)
        .sort((a, b) => gap(b, seller, buyer) - gap(a, seller, buyer))
        .slice(0, OFFERS_TRIED)
        .map((p) => ({ give: [p.id], givePicks: [], label: name(p) })),
      ...draftPicks(state, ctx.ruleset.draft.rounds, buyer)
        .sort((a, b) => b.season - a.season || b.round - a.round) // cheapest first
        .slice(0, OFFERS_TRIED)
        .map((pk) => ({
          give: [],
          givePicks: [pk.id],
          label: `${pk.season} R${pk.round} (${state.teams[pk.originalTeamId]!.abbreviation})`,
        })),
    ];
    for (const offer of offers) {
      const get = [target.id];
      const sellerSays = evaluateTrade(state, ctx, {
        fromTeamId: buyer,
        toTeamId: seller,
        give: offer.give as Player['id'][],
        get,
        givePicks: offer.givePicks,
      });
      if (!sellerSays.accepted) continue;
      const buyerSays = evaluateTrade(state, ctx, {
        fromTeamId: seller,
        toTeamId: buyer,
        give: get,
        get: offer.give as Player['id'][],
        getPicks: offer.givePicks,
      });
      if (!buyerSays.accepted) continue;
      emit('major', [buyer, seller], {
        kind: 'trade.completed',
        fromTeamId: buyer,
        toTeamId: seller,
        give: offer.give as Player['id'][],
        get,
        ...(offer.givePicks.length && { givePicks: offer.givePicks }),
      });
      const team = (id: TeamId) => `${state.teams[id]!.city} ${state.teams[id]!.name}`;
      emit('notable', [buyer, seller], {
        kind: 'news.posted',
        headline: 'event.trade',
        params: { from: team(buyer), to: team(seller), give: offer.label, get: name(target) },
      });
      return;
    }
  }
}

/** Chance an AI GM calls a human team in a given week. */
const WEEKLY_OFFER_CHANCE = 0.35;
/** Days an offer stays open. */
const OFFER_DAYS = 7;

/**
 * AI GMs make offers to human teams: one AI team picks the human's player it values most above
 * what he is worth to his own team, and offers a player of its own the human team should value
 * at least as much (by the same valuator, from the human team's situation). The AI must accept
 * its own offer under `evaluateTrade`. One open offer per human team; offers expire after a week.
 */
export function aiOffers(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  for (const o of state.tradeOffers.filter((x) => x.expiresDay <= state.date.day)) {
    emit('minor', [o.proposal.toTeamId, o.proposal.fromTeamId], {
      kind: 'trade.offerClosed',
      offerId: o.id,
      accepted: false,
    });
  }
  if (!tradeWindowOpen(state, ctx)) return;
  const teams = Object.values(state.teams).sort((a, b) => a.id.localeCompare(b.id));
  const ai = teams.filter((t) => !t.userControlled).map((t) => t.id);
  if (!ai.length) return;
  const value = valuer(state, ctx);
  const roster = (id: TeamId) =>
    Object.values(state.players)
      .filter((p) => p.teamId === id)
      .sort((a, b) => a.id.localeCompare(b.id));
  for (const human of teams.filter((t) => t.userControlled).map((t) => t.id)) {
    if (state.tradeOffers.some((o) => o.proposal.toTeamId === human)) continue;
    if (!rng.chance(WEEKLY_OFFER_CHANCE)) continue;
    const caller = rng.pick(ai);
    const gap = (p: Player, to: TeamId, from: TeamId) => value(p, to) - value(p, from);
    const target = roster(human).sort((a, b) => gap(b, caller, human) - gap(a, caller, human))[0];
    if (!target) continue;
    const offer = roster(caller)
      .filter((p) => value(p, human) >= value(target, human))
      .sort((a, b) => gap(b, human, caller) - gap(a, human, caller))
      .find(
        (p) =>
          evaluateTrade(state, ctx, {
            fromTeamId: human,
            toTeamId: caller,
            give: [target.id],
            get: [p.id],
          }).accepted,
      );
    if (!offer) continue;
    emit('notable', [human, caller], {
      kind: 'trade.offered',
      offer: {
        id: `o${state.date.season}_${state.date.day}_${human}`,
        proposal: { fromTeamId: caller, toTeamId: human, give: [offer.id], get: [target.id] },
        expiresDay: state.date.day + OFFER_DAYS,
      },
    });
  }
}
