import type { LeagueEvent } from './events';
import type { PlayerId, TeamId, TradeProposal } from './domain';

/**
 * Every action a human (or, later, a remote player) takes is a Command. Nothing in the UI
 * changes game state directly. This one rule is what makes these possible later without
 * rewrites: multiplayer (send commands over the network, the host validates them),
 * undo/replay, AI GMs using the same actions as humans, and logging.
 *
 * Commands are plain, serializable data. Add new kinds here, then a handler in
 * `packages/sim/src/commands.ts`.
 */
export type Command =
  | { kind: 'sim.advance'; days: number; stopOn?: 'never' | 'major' }
  | { kind: 'team.setUserControlled'; teamId: TeamId; userControlled: boolean }
  /** After the champion is crowned: age, retire, draft, re-sign and sign, then start next season. */
  | { kind: 'season.rollover' }
  /** Buy out a player's contract (offseason only, once the champion is crowned). */
  | { kind: 'contract.buyout'; playerId: PlayerId }
  /** Re-sign a player whose contract ends this season, for `years` seasons from next season (same window as buyouts). */
  | { kind: 'contract.resign'; playerId: PlayerId; years: number }
  /** Offer a trade; it goes through only if the other team accepts (see `evaluateTrade`). */
  | { kind: 'trade.propose'; proposal: TradeProposal }
  /** Accept or decline an AI GM's offer. Accepting still has to pass the trade rules today. */
  | { kind: 'trade.respond'; offerId: string; accept: boolean }
  /** Sit down with a player who asked for a trade; whether he withdraws depends on who he is. */
  | { kind: 'tradeRequest.talk'; playerId: PlayerId }
  /**
   * After the season: age and develop players, retire, expire contracts, hold the draft and let AI
   * teams re-sign, then open free agency for the human GM. `season.rollover` finishes the summer.
   */
  | { kind: 'offseason.openFreeAgency' }
  /** Set your depth order (best first); the lineup follows it ahead of ratings. */
  | { kind: 'lines.set'; teamId: TeamId; order: PlayerId[] }
  /** Rank the draft class for your picks (best first). Players missing from it go by the scouts' order. */
  | { kind: 'draft.setBoard'; teamId: TeamId; order: PlayerId[] }
  /** Offer a free agent `salary` a year for `years`; he signs if interested (see `signingInterest`). */
  | { kind: 'contract.sign'; playerId: PlayerId; teamId: TeamId; salary: number; years: number };
// Planned (not implemented yet): formations, line tactics ...

export type CommandKind = Command['kind'];

/** Who issued a command. Single-player is always 'local'; multiplayer adds real ids. */
export interface Actor {
  id: string;
  controls: TeamId[];
}

export type CommandError =
  | { code: 'not_allowed'; message: string }
  | { code: 'invalid'; message: string }
  | { code: 'not_implemented'; message: string };

export type CommandResult =
  { ok: true; events: LeagueEvent[] } | { ok: false; error: CommandError };
