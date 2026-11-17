import type { Rng } from '../../core';
import { rating } from './strength';
import { HOCKEY_TUNING } from './tuning';
import type { Side } from './side';

/** Three shooters each, then one at a time. Skill is shooting and hands. */
export function playShootout(
  S: readonly [Side, Side],
  rng: Rng,
  goalFactor: (n: 0 | 1) => number,
): 0 | 1 {
  const T = HOCKEY_TUNING;
  const order = ([0, 1] as const).map((n) =>
    S[n].players
      .map((_, k) => k)
      .filter((k) => !S[n].out.has(k) && !S[n].isD[k])
      .sort(
        (a, b) =>
          S[n].shoot[b]! +
            rating(S[n].players[b]!, 'puckHandling') -
            (S[n].shoot[a]! + rating(S[n].players[a]!, 'puckHandling')) || a - b,
      ),
  );
  const tally = [0, 0];
  const taken = [0, 0];
  const attempt = (n: 0 | 1, round: number) => {
    const list = order[n]!;
    const k = list[round % Math.max(1, list.length)];
    const skill = k === undefined ? 50 : S[n].shoot[k]! + rating(S[n].players[k]!, 'puckHandling');
    const p = T.shootoutGoal * (skill / 130) ** 2 * goalFactor((1 - n) as 0 | 1);
    return rng.chance(Math.min(0.9, p));
  };
  for (let round = 0; round < 3; round++) {
    for (const n of [0, 1] as const) {
      if (attempt(n, round)) tally[n]!++;
      taken[n]!++;
      // Decided once the trailing side cannot catch up with the shots it has left.
      if (tally[0]! > tally[1]! + (3 - taken[1]!)) return 0;
      if (tally[1]! > tally[0]! + (3 - taken[0]!)) return 1;
    }
  }
  if (tally[0] !== tally[1]) return tally[0]! > tally[1]! ? 0 : 1;
  for (let round = 3; round < 40; round++) {
    const a = attempt(0, round);
    const b = attempt(1, round);
    if (a !== b) return a ? 0 : 1;
  }
  return rng.chance(0.5) ? 0 : 1;
}
