import { parentPort } from 'node:worker_threads';
import { handleCommand, type LeagueState } from '@gm/sim';
import type { Actor, Command, CommandResult, HallOfFamer } from '@gm/shared';
import { contextWithXg } from './simContext';

/**
 * Runs every command off the main thread, so the UI never freezes.
 * Receives a copy of the league state + one command; returns the resulting events.
 * The main process applies the same events to its own copy (see LeagueService).
 */
export interface WorkerRequest {
  state: LeagueState;
  command: Command;
  actor: Actor;
  /** The shot-model file's JSON, if the user has one (see main/league.ts). */
  xg?: unknown;
  /** Only for `staff.hire`: the Hall of Famers who can be a candidate. */
  legends?: HallOfFamer[];
}

parentPort?.on('message', (req: WorkerRequest) => {
  const ctx = contextWithXg(req.state.rulesetId, req.xg);
  // A throw would kill this thread and leave every later command waiting forever. The state here
  // is a throwaway copy, so reporting the error and carrying on is safe.
  let result: CommandResult;
  try {
    result = handleCommand(req.state, req.command, req.actor, ctx, req.legends);
  } catch (err) {
    result = {
      ok: false,
      error: { code: 'invalid', message: `sim error: ${(err as Error).message}` },
    };
  }
  parentPort?.postMessage(result);
});
