import type { DraftClock, DraftPick, TeamId } from '@gm/shared';
import type { LeagueState } from '../core';
import type { Ruleset } from '../cba';
import { worstFirst } from './standings';

/** Drafts ahead whose picks can be traded (this coming one and the two after). */
const TRADEABLE_DRAFTS = 3;

export const pickId = (season: number, round: number, originalTeamId: string) =>
  `${season}-${round}-${originalTeamId}`;

export function parsePick(
  id: string,
): { season: number; round: number; originalTeamId: TeamId } | null {
  const m = /^(\d+)-(\d+)-(.+)$/.exec(id);
  return m ? { season: Number(m[1]), round: Number(m[2]), originalTeamId: m[3] as TeamId } : null;
}

/** A pick as the news names it: `2027 R1 (TOR)`. */
export function pickLabel(state: LeagueState, id: string): string {
  const p = parsePick(id);
  return p ? `${p.season} R${p.round} (${state.teams[p.originalTeamId]?.abbreviation})` : id;
}

/** Who makes this pick: whoever it was traded to, else the team it belongs to. */
export const pickOwner = (state: LeagueState, id: string, originalTeamId: TeamId): TeamId =>
  state.pickOwners[id] ?? originalTeamId;

/** The next draft's season: next season's class, or the one after once this summer's draft is done. */
export const nextDraftSeason = (state: LeagueState) =>
  state.date.season + (state.freeAgencyOpen ? 2 : 1);

/**
 * Pick `i` (from 0) of this summer's draft: round one follows the lottery, later rounds go worst
 * to best (`order`). A protected pick that lands high stays with the team that traded it.
 */
export function draftSlot(state: LeagueState, order: readonly TeamId[], i: number): DraftClock {
  const round = Math.floor(i / order.length) + 1;
  const slots = round === 1 && state.draftOrder.length ? state.draftOrder : order;
  const original = slots[i % order.length]!;
  const id = pickId(state.date.season + 1, round, original);
  const protection = state.pickProtection[id];
  const teamId =
    round === 1 && protection && i + 1 <= protection.top
      ? protection.keeper
      : pickOwner(state, id, original);
  return { pick: i + 1, round, id, teamId };
}

/** Every pick in the tradeable drafts, with its owner (all teams, or one owner's); picks made in the live draft are gone. */
export function draftPicks(state: LeagueState, ruleset: Ruleset, owner?: TeamId): DraftPick[] {
  const made = new Set<string>();
  if (state.draftPicksMade !== null) {
    const order = worstFirst(state, ruleset);
    for (let i = 0; i < state.draftPicksMade; i++) made.add(draftSlot(state, order, i).id);
  }
  const first = nextDraftSeason(state);
  const picks: DraftPick[] = [];
  for (let season = first; season < first + TRADEABLE_DRAFTS; season++) {
    for (let round = 1; round <= ruleset.draft.rounds; round++) {
      for (const originalTeamId of Object.keys(state.teams).sort() as TeamId[]) {
        const id = pickId(season, round, originalTeamId);
        const ownerTeamId = pickOwner(state, id, originalTeamId);
        if (!made.has(id) && (!owner || owner === ownerTeamId)) {
          picks.push({ id, season, round, originalTeamId, ownerTeamId });
        }
      }
    }
  }
  return picks;
}
