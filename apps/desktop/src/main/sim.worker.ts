import { parentPort } from 'node:worker_threads';
import { defaultContext, handleCommand, type LeagueState } from '@gm/sim';
import type { Actor, Command, CommandResult } from '@gm/shared';

/**
 * Runs every command off the main thread, so the UI never freezes.
 * Receives a copy of the league state + one command; returns the resulting events.
 * The main process applies the same events to its own copy (see LeagueService).
 */
export interface WorkerRequest {
  state: LeagueState;
  command: Command;
  actor: Actor;
}

parentPort?.on('message', (req: WorkerRequest) => {
  const ctx = defaultContext(req.state.rulesetId);
  const result: CommandResult = handleCommand(req.state, req.command, req.actor, ctx);
  parentPort?.postMessage(result);
});
