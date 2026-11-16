import type { TeamStatus } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import { overall } from '../players';
import { personalityOf } from './personality';

/** Weekly chance an eligible player goes to the GM. */
const REQUEST_CHANCE = 0.08;
const STRUGGLING: readonly TeamStatus[] = ['seller', 'rebuilder', 'crisis'];
const CORE_PLAYERS = 6;
const MIN_AGE = 27;
const AMBITIOUS = 0.7;
/** He withdraws after a talk if his loyalty and professionalism add up to this. */
const TALKED_DOWN = 1;

/**
 * Trade requests (event engine v1, human teams only): when a human team is struggling, an
 * ambitious veteran among its best players may ask out. One open request per team.
 * Until it is resolved he will not re-sign with the team (see the re-sign window).
 */
export function tradeRequests(state: LeagueState, rng: Rng, emit: Emit): void {
  for (const team of Object.values(state.teams).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!team.userControlled || !STRUGGLING.includes(state.teamStatus[team.id] ?? 'bubble')) {
      continue;
    }
    if (state.tradeRequests.some((r) => r.teamId === team.id)) continue;
    const core = Object.values(state.players)
      .filter((p) => p.teamId === team.id)
      .sort((a, b) => overall(b) - overall(a) || a.id.localeCompare(b.id))
      .slice(0, CORE_PLAYERS);
    for (const p of core) {
      if (state.date.season - p.birthYear < MIN_AGE) continue;
      if (personalityOf(p.id).ambition < AMBITIOUS) continue;
      if (!rng.chance(REQUEST_CHANCE)) continue;
      emit('major', [team.id], { kind: 'player.tradeRequested', playerId: p.id, teamId: team.id });
      break;
    }
  }
}

/** Whether a talk changes his mind: it is who he is, so the same talk always ends the same way. */
export function talkedDown(playerId: string): boolean {
  const { loyalty, professionalism } = personalityOf(playerId);
  return loyalty + professionalism >= TALKED_DOWN;
}
