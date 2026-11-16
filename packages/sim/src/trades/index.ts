/**
 * Trades engine (shared by all sports): when trades are allowed, whether a trade is legal, and
 * whether the other team says yes, with its reasons. Built on the value engine (per-team
 * surplus) and the CBA engine (cap checks). The same rules judge human and AI offers.
 * TODO(M6): draft picks, retained salary, AI-to-AI trades, trade block.
 */
export { evaluateTrade, tradeWindowOpen, teamContext } from './evaluate';
