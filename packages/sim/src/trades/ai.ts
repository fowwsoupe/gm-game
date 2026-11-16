import type { Player, TeamId, TeamStatus } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import type { SimContext } from '../context';
import { evaluateTrade, teamContext, tradeWindowOpen } from './evaluate';

/** Chance the league makes a trade in a given week (when a deal both sides like exists). */
const WEEKLY_TRADE_CHANCE = 0.8;
/** Pairs of teams tried per week. */
const PAIRS_TRIED = 12;
/** The buyer's own players it considers sending back, cheapest-to-it first. */
const OFFERS_TRIED = 8;

const BUYING: readonly TeamStatus[] = ['contender', 'buyer'];
const SELLING: readonly TeamStatus[] = ['seller', 'rebuilder', 'crisis'];

/**
 * AI GMs trade with each other: a buyer looks at a seller's roster for the player it values
 * most above what the seller does, and offers one of its own players the seller values more
 * than it does. The trade happens only if both sides accept under the same rules as a human
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

  const roster = (id: TeamId) =>
    Object.values(state.players)
      .filter((p) => p.teamId === id)
      .sort((a, b) => a.id.localeCompare(b.id));
  // Memoized for this week's search: contexts scan the whole league, values run the valuator.
  const contexts = new Map<TeamId, ReturnType<typeof teamContext>>();
  const values = new Map<string, number>();
  const value = (p: Player, teamId: TeamId) => {
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

  for (let i = 0; i < PAIRS_TRIED; i++) {
    const buyer = rng.pick(buyers);
    const seller = rng.pick(sellers);
    const gap = (p: Player, to: TeamId, from: TeamId) => value(p, to) - value(p, from);
    const target = roster(seller).sort((a, b) => gap(b, buyer, seller) - gap(a, buyer, seller))[0];
    if (!target) continue;
    const offers = roster(buyer)
      .filter((p) => gap(p, seller, buyer) > 0)
      .sort((a, b) => gap(b, seller, buyer) - gap(a, seller, buyer))
      .slice(0, OFFERS_TRIED);
    for (const offer of offers) {
      const give = [offer.id];
      const get = [target.id];
      const sellerSays = evaluateTrade(state, ctx, {
        fromTeamId: buyer,
        toTeamId: seller,
        give,
        get,
      });
      if (!sellerSays.accepted) continue;
      const buyerSays = evaluateTrade(state, ctx, {
        fromTeamId: seller,
        toTeamId: buyer,
        give: get,
        get: give,
      });
      if (!buyerSays.accepted) continue;
      emit('major', [buyer, seller], {
        kind: 'trade.completed',
        fromTeamId: buyer,
        toTeamId: seller,
        give,
        get,
      });
      const team = (id: TeamId) => `${state.teams[id]!.city} ${state.teams[id]!.name}`;
      const name = (p: Player) => `${p.firstName} ${p.lastName}`;
      emit('notable', [buyer, seller], {
        kind: 'news.posted',
        headline: 'event.trade',
        params: { from: team(buyer), to: team(seller), give: name(offer), get: name(target) },
      });
      return;
    }
  }
}
