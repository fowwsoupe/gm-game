import type { Player, PlayerId, TeamId } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import type { SimContext } from '../context';
import { overall } from '../players';
import {
  ageIn,
  allPlayers,
  countAt,
  entryContract,
  freeAgents,
  neededPosition,
  offerContract,
  rosterOf,
} from './roster';

/** The median overall rating of players on a roster. */
function typicalRating(state: LeagueState): number {
  const rostered = allPlayers(state)
    .filter((p) => p.teamId !== null)
    .map(overall)
    .sort((a, b) => a - b);
  return rostered[Math.floor(rostered.length / 2)] ?? 0;
}

/** Chance a player agrees to re-sign with his team. */
const RESIGN_CHANCE = 0.6;

/** How far below the league's typical rostered player a player may be and still get re-signed. */
const RESIGN_SLACK = 8;

/** Contract length a player of this age would like (an upper bound; the ruleset caps it). */
const wantedYears = (age: number, rng: Rng) => rng.int(1, age < 28 ? 5 : age < 32 ? 3 : 2);

/**
 * Step 3: contracts that ran out make the player a free agent.
 * Returns who expired from which team, so that team can try to re-sign them first.
 */
export function expireContracts(state: LeagueState, emit: Emit): Map<TeamId, PlayerId[]> {
  const expiring = new Map<TeamId, PlayerId[]>();
  for (const p of allPlayers(state)) {
    if (p.teamId === null || !p.contract || p.contract.expiresAfterSeason > state.date.season)
      continue;
    expiring.set(p.teamId, [...(expiring.get(p.teamId) ?? []), p.id]);
    emit('minor', [p.teamId], { kind: 'contract.expired', playerId: p.id });
  }
  return expiring;
}

/**
 * Step 5a: each team re-signs its own expired players, best first, while it has a roster spot
 * and cap room. Players clearly below the league's typical rostered player walk, unless the
 * team needs that position.
 */
export function reSignPlayers(
  state: LeagueState,
  ctx: SimContext,
  rng: Rng,
  emit: Emit,
  season: number,
  expiring: ReadonlyMap<TeamId, readonly PlayerId[]>,
) {
  const { ruleset } = ctx;
  const typical = typicalRating(state);

  for (const teamId of [...expiring.keys()].sort()) {
    const candidates = expiring
      .get(teamId)!
      .map((id) => state.players[id])
      .filter((p): p is Player => !!p)
      .sort((a, b) => overall(b) - overall(a) || a.id.localeCompare(b.id));
    for (const p of candidates) {
      const roster = rosterOf(state, teamId);
      if (roster.length >= ruleset.roster.maxActive) break;
      const needed = countAt(roster, p.position) < (ruleset.roster.positionMin[p.position] ?? 0);
      if (!needed && overall(p) < typical - RESIGN_SLACK) continue;
      // Not every player wants to stay: some test the market (and the worst teams pick first).
      if (!rng.chance(RESIGN_CHANCE)) continue;
      const contract = offerContract(
        ruleset,
        roster,
        p,
        season,
        wantedYears(ageIn(p, season), rng),
        { isResign: true, discount: false },
      );
      if (contract) {
        emit('minor', [teamId], { kind: 'player.signed', playerId: p.id, teamId, contract });
      }
    }
  }
}

/**
 * Step 5b: free agency. In rounds, each team below its position or roster minimum signs the
 * best free agent it can afford for what it needs; if the pool has nobody it can afford, it
 * signs a freshly generated undrafted player instead, so a team is never left short.
 * Teams only fill to the minimum. Worst teams go first.
 * TODO(M6): interest meter, player preferences, AI priorities beyond "best available".
 */
export function fillRosters(
  state: LeagueState,
  ctx: SimContext,
  rng: Rng,
  emit: Emit,
  season: number,
  order: readonly TeamId[],
) {
  const { ruleset } = ctx;
  let undrafted = 0;

  const signOne = (teamId: TeamId): boolean => {
    const roster = rosterOf(state, teamId);
    const position = neededPosition(ruleset, roster);
    if (position === null && roster.length >= ruleset.roster.minActive) return false;
    const pool = freeAgents(state)
      .filter((p) => position === null || p.position === position)
      .sort((a, b) => overall(b) - overall(a) || a.id.localeCompare(b.id));
    for (const p of pool) {
      const contract = offerContract(
        ruleset,
        roster,
        p,
        season,
        wantedYears(ageIn(p, season), rng),
        { isResign: false, discount: true },
      );
      if (contract) {
        emit('minor', [teamId], { kind: 'player.signed', playerId: p.id, teamId, contract });
        return true;
      }
    }
    // Nobody in the pool fits: sign an undrafted rookie (generated, so the pool never runs dry).
    const rookie = ctx.sport.generateProspect(rng, {
      id: `u${season}_${undrafted++}`,
      season,
      ...(position ? { position } : {}),
    });
    const contract = entryContract(ruleset, roster, rookie, season);
    if (!contract) return false;
    emit('minor', [teamId], {
      kind: 'player.drafted',
      player: { ...rookie, teamId, contract },
      round: 0,
      pick: 0,
    });
    return true;
  };

  while (order.map(signOne).some(Boolean)) {
    // keep going until a whole pass signs nobody
  }
}
