import type { LeagueEvent } from './events';
import type { Department, PlayerId, TeamId, TradeProposal } from './domain';
import type { GoalieRotation, SpecialUnit } from './sports/hockey';

/**
 * Every action a human (or, later, a remote player) takes is a Command. Nothing in the UI
 * changes game state directly. This one rule is what makes these possible later without
 * rewrites: multiplayer (send commands over the network, the host validates them),
 * undo/replay, AI GMs using the same actions as humans, and logging.
 *
 * Commands are plain, serializable data. Add new kinds here, then a handler in
 * `packages/sim/src/commands.ts`.
 */
/**
 * What stops "sim until it matters": league-wide moments (phase change, champion), your team's
 * big moments (its series, its trades), offers waiting on you, and long injuries to your players.
 * Being fired always stops it.
 */
export const STOP_CATEGORIES = ['league', 'yours', 'offers', 'injuries'] as const;
export type StopCategory = (typeof STOP_CATEGORIES)[number];

export type Command =
  /** `stopOn`: 'major' stops on every category, a list on just those (`STOP_CATEGORIES`). */
  | { kind: 'sim.advance'; days: number; stopOn?: 'never' | 'major' | readonly StopCategory[] }
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
  /** Meet a player who is holding out; whether he reports is down to who he is. */
  | { kind: 'holdout.talk'; playerId: PlayerId }
  /** Answer a player's complaint about his role: promise him one, ask for patience, or list him. */
  | { kind: 'dispute.talk'; playerId: PlayerId; answer: 'promise' | 'patience' | 'block' }
  /**
   * After the season: age and develop players, retire, expire contracts, hold the draft and let AI
   * teams re-sign, then open free agency for the human GM. `season.rollover` finishes the summer.
   */
  | { kind: 'offseason.openFreeAgency' }
  /** Set your depth order (best first); the lineup follows it ahead of ratings. */
  | { kind: 'lines.set'; teamId: TeamId; order: PlayerId[] }
  /** Set a power-play or penalty-kill unit (3F+2D / 2F+2D); an empty list goes back to auto. */
  | { kind: 'units.set'; teamId: TeamId; unit: SpecialUnit; playerIds: PlayerId[] }
  /** Put a player on your trade block (AI GMs call about him more) or take him off. */
  | { kind: 'trade.block'; teamId: TeamId; playerId: PlayerId; onBlock: boolean }
  /** Out of work: take the job a team with a vacancy offered (see `Career`). */
  | { kind: 'career.takeJob'; teamId: TeamId }
  /** The save option: whether owners may fire you. */
  | { kind: 'league.setCanBeFired'; on: boolean }
  /** The save option: what stops "sim until it matters". */
  | { kind: 'league.setStopOn'; stopOn: StopCategory[] }
  /** Answer one of your owner's cards with one of its options. */
  | { kind: 'owner.answerCard'; cardId: string; option: string }
  /** Your ticket price policy, `pct` one of `TICKET_STEPS` around the league's reference price. */
  | { kind: 'finance.setTicketPrice'; teamId: TeamId; pct: number }
  /** Replace a department head with one of this season's candidates (`staffCandidates`, by index). */
  | { kind: 'staff.hire'; teamId: TeamId; department: Department; candidate: number }
  /** How your goalies share starts (see `GoalieRotation`). */
  | { kind: 'goalies.setRotation'; teamId: TeamId; rotation: GoalieRotation }
  /** Rank the draft class for your picks (best first). Players missing from it go by the scouts' order. */
  | { kind: 'draft.setBoard'; teamId: TeamId; order: PlayerId[] }
  /** One day of free agency: free agents answer the offers they have, then AI teams make new ones. */
  | { kind: 'freeAgency.advanceDay' }
  /** Match the offer sheet another team gave your restricted free agent: he signs with you on its terms. */
  | { kind: 'freeAgency.matchSheet'; playerId: PlayerId; teamId: TeamId }
  /** Let the offer sheet stand: he signs with the other team. */
  | { kind: 'freeAgency.declineSheet'; playerId: PlayerId; teamId: TeamId }
  /**
   * Offer a free agent `salary` a year for `years`. He signs now if interested and no AI team has
   * an offer to him; otherwise your offer joins theirs and he picks the best next day. `noTrade`
   * adds a no-trade clause: the player likes it, the CBA caps how many a team may hold.
   * `bonusPct`: share of the salary paid as a signing bonus (CBA-capped): the player likes the cash,
   * and a buyout never owes it.
   */
  | {
      kind: 'contract.sign';
      playerId: PlayerId;
      teamId: TeamId;
      salary: number;
      years: number;
      noTrade?: true;
      bonusPct?: number;
    };
// Planned (not implemented yet): formations, line tactics ...

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
