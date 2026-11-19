/**
 * Trades engine (shared by all sports): when trades are allowed, whether a trade is legal, and
 * whether the other team says yes, with its reasons. Built on the value engine (per-team
 * surplus) and the CBA engine (cap checks). The same rules judge human and AI offers.
 * AI GMs trade with each other once a week at most (`aiTrades`).
 */
export { cachedContext, evaluateTrade, planRetention, tradeWindowOpen } from './evaluate';
export { aiOffers, aiTrades } from './ai';
