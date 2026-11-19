import type { Player, PlayerProfile, TeamId } from '@gm/shared';
import { Rng, type LeagueState } from './core';
import { percentileRank } from './players';
import { hash, moraleOf, notableTraits, personalityOf, staffOf } from './people';
import type { SimContext } from './context';

/**
 * Player cards for one team (`null` = the free agents): where each hidden rating ranks among
 * rostered players with the same rating keys, and this regular season's stat line.
 * Sorted by the sport's position order, then name. A player not on a human team is seen through
 * the human's analytics department: each rating is off by a fixed amount per player, smaller the
 * better the department. View only; the sim and the AI use true ratings.
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
  const viewer = Object.values(state.teams).find((t) => t.userControlled);
  const fo = ctx.ruleset.frontOffice;
  const q = viewer ? staffOf(viewer, 'analytics', fo.salary, state.date.season).quality : 1;
  const sd = fo.analytics.best + (1 - q) * (fo.analytics.worst - fo.analytics.best);
  const seen = (p: Player, keys: readonly string[]) => {
    const exact = !viewer || (p.teamId !== null && state.teams[p.teamId]?.userControlled);
    const r = new Rng(hash(`analytics:${viewer?.id}:${p.id}`));
    return keys.map((key) => (p.ratings[key] ?? 0) + (exact ? 0 : r.normal(0, sd)));
  };

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
      const ratings = seen(p, keys);
      const percentiles = keys.map((key, i) => ({
        key,
        value: percentileRank(ratings[i]!, population(keys, key)),
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
        ...(p.injuryHistory && { injuryHistory: { ...p.injuryHistory } }),
        ...(state.holdouts.some((h) => h.playerId === p.id) && { holdout: true as const }),
        percentiles,
        ...sport.role(p.position, percentiles),
        traits: notableTraits(personalityOf(p.id)),
        stats: lines.get(p.id) ?? {},
        ask: ctx.models.contractDemand.ask(ctx.ruleset, p),
        ...(state.tradeBlock.includes(p.id) && { onBlock: true as const }),
        ...(p.teamId !== null && { morale: moraleOf(state, ctx, p) }),
        ...(p.teamId === null && state.rfaRights[p.id] && { rightsTeamId: state.rfaRights[p.id] }),
        rivalOffers: state.faOffers.filter(
          (o) => o.playerId === p.id && !state.teams[o.teamId]?.userControlled,
        ).length,
      };
    });
}
