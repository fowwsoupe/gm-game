import { GOALIE_RATINGS, SKATER_RATINGS, type Player } from '@gm/shared';
import type { Rng } from '../../core';
import { ratingGroup, type RatingGroup } from './ratingsFromStats';
import { RATINGS_TO_STATS } from './ratingsToStatsTable';

/**
 * Ratings to stats: a main-league player's per-game rates from his ratings, fitted on the sim's
 * own seasons by `pnpm ratings:fit`. Each stat is an intercept, then one coefficient per rating
 * key (`SKATER_RATINGS` or `GOALIE_RATINGS` order). Skaters' goals and assists are the log of the
 * rate per game, so a rating far below the main league's still scores a little; goalies' save %
 * is the rate itself.
 */
export interface RatingsToStatsTable {
  format: 'gm-ratings-to-stats';
  version: 1;
  source: string;
  groups: Record<RatingGroup, Record<string, number[]>>;
}

/**
 * Hockey's lower leagues (docs/research/2026-11-minor-leagues.md): `nhle`, the share of a scoring
 * rate that carries over to the main league (NHL equivalency); `games` in a season; `savePct`,
 * what a goalie adds there to his main-league save %. ponytail: the 2014 WHL and KHL factors,
 * general-knowledge game counts and game-number save % offsets; lab targets until an updated
 * NHLe table is in a report.
 */
export const HOCKEY_LEAGUES: Readonly<
  Record<string, { nhle: number; games: number; savePct: number }>
> = {
  junior: { nhle: 0.3, games: 68, savePct: 0.01 },
  europe: { nhle: 0.82, games: 52, savePct: 0.012 },
};

/** Share of his league's games a prospect plays (goalies share the net), and a season's luck. */
const PLAYED = { skater: [0.75, 1], goalie: [0.45, 0.8] } as const;
const LUCK = { rate: 0.15, savePct: 0.008 };

/** A Poisson draw (Knuth's method): fine for the few dozen goals or assists of a season. */
function poisson(rng: Rng, mean: number): number {
  const floor = Math.exp(-mean);
  let n = 0;
  for (let p = rng.next(); p > floor; p *= rng.next()) n++;
  return n;
}

/**
 * One season's line in a lower league, drawn from his ratings (no games are played there): what
 * he would score over a main-league season at the sim's rates, divided by the league's NHLe
 * factor, with a season's luck. Skaters: gp, goals, assists, points; goalies: gp, save %.
 */
export function hockeyLeagueLine(player: Player, league: string, rng: Rng): Record<string, number> {
  const l = HOCKEY_LEAGUES[league];
  if (!l) throw new Error(`unknown league ${league}`);
  const group = ratingGroup(player.position);
  const keys = group === 'G' ? GOALIE_RATINGS : SKATER_RATINGS;
  const fit = (stat: string) =>
    RATINGS_TO_STATS.groups[group][stat]!.reduce(
      (s, c, i) => s + c * (i ? (player.ratings[keys[i - 1]!] ?? 50) : 1),
      0,
    );
  const [lo, hi] = group === 'G' ? PLAYED.goalie : PLAYED.skater;
  const gp = Math.round(l.games * (lo + (hi - lo) * rng.next()));
  if (group === 'G') {
    const savePct = fit('savePct') + l.savePct + rng.normal(0, LUCK.savePct);
    return { gp, savePct: Math.round(1000 * savePct) / 1000 };
  }
  const luck = Math.exp(rng.normal(0, LUCK.rate));
  const count = (stat: string) => poisson(rng, (gp * luck * Math.exp(fit(stat))) / l.nhle);
  const goals = count('goals');
  const assists = count('assists');
  return { gp, goals, assists, points: goals + assists };
}
