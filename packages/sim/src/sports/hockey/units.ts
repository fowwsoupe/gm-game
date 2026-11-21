import type { Rng } from '../../core';
import { ICE_TIME } from './strength';
import type { Side } from './side';

/** Share of power-play and penalty-kill time played by the first and second unit. */
const UNIT_SPLIT = [0.55, 0.45] as const;

/** Index of one weight picked in proportion to its size. */
export function pick(weights: readonly number[], rng: Rng): number {
  let roll = rng.next() * weights.reduce((a, b) => a + b, 0);
  const i = weights.findIndex((w) => (roll -= w) < 0);
  return i < 0 ? weights.length - 1 : i;
}

/** Index of one forward line or defence pair, by ice time (empty ones never play), or -1 if all are empty. */
function pickShare(units: number[][], shares: readonly number[], rng: Rng) {
  const weights = units.map((u, i) => (u.length ? shares[i]! : 0));
  return weights.some((w) => w > 0) ? pick(weights, rng) : -1;
}

/**
 * A line match (`match` in `BENCH_ORDERS`): the forward lines' shares of the next shift for a
 * coach who named `line`. Against the other team's first line (`top`) only that line goes out;
 * its other shifts go to his other lines by their shares.
 */
export const matchShares = (line: number, top: boolean): number[] =>
  ICE_TIME.forwardLines.map((w, i) => ((i === line) === top ? w : 0));

/** A skater of the same kind who is healthy and not already out there; the deepest first. */
function spare(s: Side, k: number, unit: number[]) {
  const group = (s.isD[k] ? s.pairs : s.lines).flat();
  return group.filter((j) => !unit.includes(j) && !s.out.has(j)).at(-1);
}

/**
 * The skaters a side sends out: even strength by ice time (or by `lineShares`, a coach matching
 * a line), or a power-play / penalty-kill unit.
 */
export function buildUnit(
  s: Side,
  kind: 'ev' | 'pp' | 'pk',
  size: number,
  rng: Rng,
  lineShares?: readonly number[],
): number[] {
  const nd = size >= 4 ? 2 : 1;
  const nf = size - nd;
  let f: number[];
  let d: number[];
  if (kind === 'ev') {
    // A match that leaves no line to send (the named one is empty, or the only one) is no match.
    let li = lineShares ? pickShare(s.lines, lineShares, rng) : -1;
    if (li < 0) li = pickShare(s.lines, ICE_TIME.forwardLines, rng);
    const pi = pickShare(s.pairs, ICE_TIME.defensePairs, rng);
    f = li < 0 ? [] : s.lines[li]!.slice(0, nf);
    d = pi < 0 ? [] : s.pairs[pi]!.slice(0, nd);
    // An extra attacker (goalie pulled) is the best other forward still in the game.
    const extra = s.lines
      .flat()
      .filter((k) => !f.includes(k) && !s.out.has(k))
      .sort((a, b) => s.atk[b]! - s.atk[a]! || a - b);
    while (f.length < nf && extra.length) f.push(extra.shift()!);
  } else {
    const k = pick(
      UNIT_SPLIT.map((w, i) => (s.pairs[i]?.length || s.lines[i]?.length ? w : 0)),
      rng,
    );
    const mine = s.saved[kind][k];
    // A saved power play keeps its own mix (4F+1D, 5F...): the defence count comes from the unit.
    const nds = kind === 'pp' && mine ? Math.min(mine.d.length, nd) : nd;
    d = (mine?.d ?? s.pairs[k] ?? []).slice(0, nds);
    f = (mine?.f ?? (kind === 'pp' ? (s.lines[k] ?? []) : (s.killers[k] ?? []))).slice(
      0,
      size - nds,
    );
  }
  const unit = [...f, ...d];
  return unit
    .map((k) => (s.out.has(k) ? (spare(s, k, unit) ?? k) : k))
    .filter((k) => !s.out.has(k));
}
