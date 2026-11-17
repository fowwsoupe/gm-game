import type { DraftProspect, ScoutReport } from '@gm/shared';
import { Rng } from '../core';
import type { SimContext } from '../context';
import { hash } from '../people';

/** How far a scout's read of one current rating is off (rating points). */
const READ_SD = 5;
/** A prospect whose read ratings average this far under his potential still needs years. */
const RAW_GAP = 12;

/**
 * A scout's report on a prospect: his two best and his weakest rating as the scouts read them
 * (each read is off by a little, the same every time for the same prospect), and whether he
 * could play soon or is raw. It never shows potential beyond the public range.
 */
export function scoutReport(ctx: SimContext, d: DraftProspect): ScoutReport {
  const { player } = d;
  const reads = ctx.sport.ratingKeys(player.position).map((key) => ({
    key,
    read:
      (player.ratings[key] ?? 0) + new Rng(hash(`scout:${player.id}:${key}`)).normal(0, READ_SD),
  }));
  const ranked = [...reads].sort((a, b) => b.read - a.read || a.key.localeCompare(b.key));
  const mean = reads.reduce((s, r) => s + r.read, 0) / Math.max(1, reads.length);
  return {
    strengths: ranked.slice(0, 2).map((r) => r.key),
    weakness: ranked.at(-1)?.key ?? '',
    ready: mean >= (d.low + d.high) / 2 - RAW_GAP,
  };
}
