/**
 * Awards engine (shared by all sports): end-of-season awards, given as `award.given` events
 * plus a news line each. The sport module picks the player winners; the champion is shared.
 */
import { playerName, type Emit, type LeagueState } from '../core';
import type { SimContext } from '../context';

export function giveSeasonAwards(state: LeagueState, ctx: SimContext, emit: Emit): void {
  const season = state.date.season;
  const champion = state.championTeamId;
  if (champion) {
    emit('minor', [champion], { kind: 'award.given', award: 'champion', season, teamId: champion });
  }

  const winners = ctx.sport.pickAwards({
    season,
    rules: ctx.ruleset,
    players: Object.values(state.players).sort((a, b) => a.id.localeCompare(b.id)),
    results: Object.values(state.results).filter((g) => !g.playoffSeriesId),
    playoffResults: Object.values(state.results).filter((g) => g.playoffSeriesId),
    championTeamId: champion,
  });
  for (const { award, playerId } of winners) {
    const player = state.players[playerId]!;
    const team = state.teams[player.teamId!]!;
    emit('minor', [team.id], { kind: 'award.given', award, season, teamId: team.id, playerId });
    emit('notable', [team.id], {
      kind: 'news.posted',
      headline: 'event.awardWon',
      params: { award, player: playerName(player), team: team.name },
    });
  }
}
