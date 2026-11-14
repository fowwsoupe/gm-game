import { parentPort } from 'node:worker_threads';
import { Rng, simGame, type MatchupInput } from '@gm/sim';
import type { GameResult } from '@gm/shared';

/**
 * Runs the pure sim engine off the main thread. Messages in, results out.
 * Only plain data crosses this boundary (no class instances, no db handles).
 */
export interface SimRequest {
  seed: number;
  matchups: MatchupInput[];
}
export interface SimResponse {
  results: GameResult[];
  nextSeed: number;
}

parentPort?.on('message', (req: SimRequest) => {
  const rng = new Rng(req.seed);
  const results = req.matchups.map((m) => simGame(m, rng));
  const res: SimResponse = { results, nextSeed: rng.state };
  parentPort?.postMessage(res);
});
