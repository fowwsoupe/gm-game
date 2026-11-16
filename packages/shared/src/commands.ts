import type { LeagueEvent } from './events';
import type { TeamId } from './domain';

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
  | { kind: 'season.rollover' };
// Planned (not implemented yet): 'trade.propose', 'contract.offer', 'lines.set', 'draft.pick' ...

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
