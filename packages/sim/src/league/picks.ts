import type { DraftPick, TeamId } from '@gm/shared';
import type { LeagueState } from '../core';

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

/** Who makes this pick: whoever it was traded to, else the team it belongs to. */
export const pickOwner = (state: LeagueState, id: string, originalTeamId: TeamId): TeamId =>
  state.pickOwners[id] ?? originalTeamId;

/** The next draft's season: next season's class, or the one after once this summer's draft is done. */
export const nextDraftSeason = (state: LeagueState) =>
  state.date.season + (state.freeAgencyOpen ? 2 : 1);

/** Every pick in the tradeable drafts, with its owner (all teams, or one owner's). */
export function draftPicks(state: LeagueState, rounds: number, owner?: TeamId): DraftPick[] {
  const first = nextDraftSeason(state);
  const picks: DraftPick[] = [];
  for (let season = first; season < first + TRADEABLE_DRAFTS; season++) {
    for (let round = 1; round <= rounds; round++) {
      for (const originalTeamId of Object.keys(state.teams).sort() as TeamId[]) {
        const id = pickId(season, round, originalTeamId);
        const ownerTeamId = pickOwner(state, id, originalTeamId);
        if (!owner || owner === ownerTeamId) {
          picks.push({ id, season, round, originalTeamId, ownerTeamId });
        }
      }
    }
  }
  return picks;
}
