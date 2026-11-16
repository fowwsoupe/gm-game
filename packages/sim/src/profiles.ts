import type { PlayerProfile, TeamId } from '@gm/shared';
import type { LeagueState } from './core';
import { percentileRank } from './players';
import type { SimContext } from './context';

/**
 * Player cards for one team (`null` = the free agents): where each hidden rating ranks among
 * rostered players with the same rating keys, and this regular season's stat line.
 * Sorted by the sport's position order, then name.
 */
export function playerProfiles(
  state: LeagueState,
  ctx: SimContext,
  teamId: TeamId | null,
): PlayerProfile[] {
  const { sport } = ctx;
  const all = Object.values(state.players);
  // Population per rating-key list (the sport returns the same list for one group).
  const populations = new Map<readonly string[], Map<string, number[]>>();
  const population = (keys: readonly string[], key: string) => {
    let group = populations.get(keys);
    if (!group) {
      group = new Map();
      populations.set(keys, group);
    }
    let values = group.get(key);
    if (!values) {
      values = all
        .filter((p) => p.teamId !== null && sport.ratingKeys(p.position) === keys)
        .map((p) => p.ratings[key] ?? 0);
      group.set(key, values);
    }
    return values;
  };
  const lines = sport.playerLines(Object.values(state.results).filter((g) => !g.playoffSeriesId));
  const order = (position: string) => sport.positions.indexOf(position);

  return all
    .filter((p) => p.teamId === teamId)
    .sort(
      (a, b) =>
        order(a.position) - order(b.position) ||
        a.lastName.localeCompare(b.lastName) ||
        a.id.localeCompare(b.id),
    )
    .map((p) => {
      const keys = sport.ratingKeys(p.position);
      const percentiles = keys.map((key) => ({
        key,
        value: percentileRank(p.ratings[key] ?? 0, population(keys, key)),
      }));
      return {
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        birthYear: p.birthYear,
        position: p.position,
        teamId: p.teamId,
        age: state.date.season - p.birthYear,
        ...(p.contract && { contract: { ...p.contract } }),
        ...((p.injuredUntil ?? 0) > state.date.day && { injuredUntil: p.injuredUntil }),
        percentiles,
        ...sport.role(p.position, percentiles),
        stats: lines.get(p.id) ?? {},
        ask: ctx.models.contractDemand.ask(ctx.ruleset, p),
      };
    });
}
