import type { Emit, LeagueState, Rng } from '../core';
import type { SimContext } from '../context';
import { overall } from '../players';
import { personalityOf } from './personality';

const CORE_PLAYERS = 6;
/** Paid under this share of his ask, with a greedy streak, he may refuse to report. */
const UNDERPAID = 0.75;
const GREEDY = 0.6;
/** Chance he actually does, at the start of the season (on an AI team, half that: a few a year). */
const HOLDOUT_CHANCE = 0.5;
const AI_HOLDOUT_CHANCE = 0.25;
/** Weekly chance a holdout gives up and reports. */
const GIVES_UP = 0.2;
/** He reports after a talk if his loyalty and professionalism add up to this. */
const TALKED_ROUND = 1.2;

/**
 * Holdouts: at the start of the season a core player who is paid well under his ask, and
 * greedy, may refuse to report. One per team. A holdout sits out of every game until he gets an
 * extension, is talked round (human GMs), is traded, or gives up (`holdoutsWeek`). AI GMs
 * settle theirs in `aiHoldouts` (offseason engine) or wait them out.
 */
export function startHoldouts(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  for (const team of Object.values(state.teams).sort((a, b) => a.id.localeCompare(b.id))) {
    if (state.holdouts.some((h) => h.teamId === team.id)) continue;
    const core = Object.values(state.players)
      .filter((p) => p.teamId === team.id)
      .sort((a, b) => overall(b) - overall(a) || a.id.localeCompare(b.id))
      .slice(0, CORE_PLAYERS);
    for (const p of core) {
      const ask = ctx.models.contractDemand.ask(ctx.ruleset, p);
      if (!p.contract || p.extension || p.contract.capHit >= ask * UNDERPAID) continue;
      if (
        personalityOf(p.id).greed < GREEDY ||
        !rng.chance(team.userControlled ? HOLDOUT_CHANCE : AI_HOLDOUT_CHANCE)
      )
        continue;
      emit(team.userControlled ? 'major' : 'notable', [team.id], {
        kind: 'player.holdoutStarted',
        playerId: p.id,
        teamId: team.id,
      });
      break;
    }
  }
}

/** Once a week a holdout may give up and report. */
export function holdoutsWeek(state: LeagueState, rng: Rng, emit: Emit): void {
  for (const h of [...state.holdouts].sort((a, b) => a.playerId.localeCompare(b.playerId))) {
    if (rng.chance(GIVES_UP)) {
      emit('notable', [h.teamId], {
        kind: 'player.holdoutEnded',
        playerId: h.playerId,
        talked: false,
      });
    }
  }
}

/** Whether a talk gets him to report: it is who he is, so the same talk always ends the same way. */
export function talkedRound(playerId: string): boolean {
  const { loyalty, professionalism } = personalityOf(playerId);
  return loyalty + professionalism >= TALKED_ROUND;
}
