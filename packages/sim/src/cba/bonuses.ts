import type { CapCharge, PlayerId, TeamId } from '@gm/shared';
import type { Emit, LeagueState } from '../core';
import type { SimContext } from '../context';
import { contractIn } from './contracts';
import { teamCapTotal } from './cap';

/**
 * Pays this season's performance bonuses (call before the champion is crowned, while the cap
 * year is still this season). Each player with a `perfBonus` earns the share his regular season
 * met (`sport.bonusEarned`). A team whose cap total plus bonuses goes over the upper limit carries
 * the overage to next season's cap, charged to its biggest earners first. Returns what was paid.
 */
export function payBonuses(
  state: LeagueState,
  ctx: SimContext,
  emit: Emit,
): { playerId: PlayerId; teamId: TeamId; amount: number }[] {
  const season = state.date.season;
  const lines = ctx.sport.playerLines(
    Object.values(state.results).filter((g) => !g.playoffSeriesId),
  );
  const games = ctx.ruleset.season.gamesPerTeam;
  const paid: { playerId: PlayerId; teamId: TeamId; amount: number }[] = [];
  for (const p of Object.values(state.players).sort((a, b) => a.id.localeCompare(b.id))) {
    const bonus = p.teamId ? contractIn(p, season)?.perfBonus : undefined;
    const line = lines.get(p.id);
    if (!bonus || !line || !p.teamId) continue;
    const amount = Math.round(bonus * ctx.sport.bonusEarned(line, games));
    if (amount > 0) paid.push({ playerId: p.id, teamId: p.teamId, amount });
  }
  if (!paid.length) return paid;
  const teams = [...new Set(paid.map((x) => x.teamId))].sort();
  const charges: CapCharge[] = [];
  for (const teamId of teams) {
    const mine = paid.filter((x) => x.teamId === teamId).sort((a, b) => b.amount - a.amount);
    const total = mine.reduce((s, x) => s + x.amount, 0);
    let over = teamCapTotal(ctx.ruleset, state, teamId) + total - ctx.ruleset.cap.upperLimit;
    for (const x of mine) {
      if (over <= 0) break;
      const amount = Math.min(over, x.amount);
      charges.push({
        teamId,
        playerId: x.playerId,
        kind: 'bonusOverage',
        season: season + 1,
        amount,
      });
      over -= amount;
    }
  }
  emit(teams.some((id) => state.teams[id]?.userControlled) ? 'notable' : 'minor', teams, {
    kind: 'bonuses.paid',
    season,
    paid,
    charges,
  });
  return paid;
}
