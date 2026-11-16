import type { Player, PlayerId, TeamId } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import type { SimContext } from '../context';
import { payroll } from '../cba';
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
export const wantedYears = (age: number, rng: Rng) => rng.int(1, age < 28 ? 5 : age < 32 ? 3 : 2);

/**
 * Step 3: contracts that ran out make the player a free agent, unless he signed an extension
 * in season: then the extension starts. Returns who expired from which team, so that team can
 * try to re-sign them first.
 */
export function expireContracts(state: LeagueState, emit: Emit): Map<TeamId, PlayerId[]> {
  const expiring = new Map<TeamId, PlayerId[]>();
  for (const p of allPlayers(state)) {
    if (p.teamId === null || !p.contract || p.contract.expiresAfterSeason > state.date.season)
      continue;
    if (p.extension) {
      emit('minor', [p.teamId], {
        kind: 'player.signed',
        playerId: p.id,
        teamId: p.teamId,
        contract: p.extension,
      });
      continue;
    }
    expiring.set(p.teamId, [...(expiring.get(p.teamId) ?? []), p.id]);
    emit('minor', [p.teamId], { kind: 'contract.expired', playerId: p.id });
  }
  return expiring;
}

/**
 * Step 5: each team re-signs its own expired players, best first, while it has a roster spot
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
    // A human GM re-signs his own players in the re-sign window; the rest walk.
    if (state.teams[teamId]?.userControlled) continue;
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
        { isResign: true, discount: false, ask: ctx.models.contractDemand.ask(ruleset, p) },
      );
      if (contract) {
        emit('minor', [teamId], { kind: 'player.signed', playerId: p.id, teamId, contract });
      }
    }
  }
}

/**
 * Step 6: free agency. In rounds, each team below its position or roster minimum signs the
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
        { isResign: false, discount: true, ask: ctx.models.contractDemand.ask(ruleset, p) },
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

/**
 * Step 7: a team below the cap floor signs the best free agent it can, paying at least what
 * it is short of the floor (real teams overpay to get there). Usually one signing does it.
 * Worst teams go first. Like the draft, this can take a roster past the maximum: until
 * prospects and minor leagues exist, every signed player counts as rostered.
 */
export function meetCapFloor(
  state: LeagueState,
  ctx: SimContext,
  rng: Rng,
  emit: Emit,
  season: number,
  order: readonly TeamId[],
) {
  const { ruleset } = ctx;
  let extra = 0;
  for (const teamId of order) {
    for (;;) {
      const roster = rosterOf(state, teamId);
      const short = ruleset.cap.lowerLimit - payroll(roster);
      if (short <= 0) break;
      const signed = freeAgents(state)
        .sort((a, b) => overall(b) - overall(a) || a.id.localeCompare(b.id))
        .some((p) => {
          const contract = offerContract(
            ruleset,
            roster,
            p,
            season,
            wantedYears(ageIn(p, season), rng),
            {
              isResign: false,
              discount: false,
              atLeast: short,
              ask: ctx.models.contractDemand.ask(ruleset, p),
            },
          );
          if (contract) {
            emit('minor', [teamId], { kind: 'player.signed', playerId: p.id, teamId, contract });
          }
          return contract !== null;
        });
      if (signed) continue;
      // Nobody left in the pool (it can run dry): sign a generated undrafted player for the
      // shortfall on a one-year deal, as fillRosters does for roster spots, so no team stays
      // under the floor. He is back in the pool next summer.
      // shortcut: an overpaid teenager is unrealistic; generate veteran free agents once M6 has a market.
      const rookie = ctx.sport.generateProspect(rng, { id: `f${season}_${extra++}`, season });
      const contract = offerContract(ruleset, roster, rookie, season, 1, {
        isResign: false,
        discount: false,
        atLeast: short,
        ask: ctx.models.contractDemand.ask(ruleset, rookie),
      });
      if (!contract) break;
      emit('minor', [teamId], {
        kind: 'player.drafted',
        player: { ...rookie, teamId, contract },
        round: 0,
        pick: 0,
      });
    }
  }
}
