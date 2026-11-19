import type { Player, PlayerId, Prospect, TeamId, TeamStatus } from '@gm/shared';
import { prospectsOf, type Emit, type LeagueState, type Rng } from '../core';
import type { SimContext } from '../context';
import { deadCap, payroll, prospectDeal } from '../cba';
import { byOverall, overall } from '../players';
import { personalityOf, planStatus, seenBy } from '../people';
import { teamRange } from './draft';
import {
  ageIn,
  resignAsk,
  allPlayers,
  capRoom,
  countAt,
  drawYears,
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

/** A rebuilding team does not re-sign players this old. */
const REBUILD_LETS_GO = 30;

/** Chance an average player agrees to re-sign with his team: players like to stay with a winner. */
const RESIGN_CHANCE: Record<TeamStatus, number> = {
  contender: 0.78,
  buyer: 0.7,
  bubble: 0.6,
  seller: 0.52,
  rebuilder: 0.45,
  crisis: 0.45,
};

/** A fully loyal player stays this much more often than an average one, a disloyal one this much less. */
const LOYALTY_SWING = 0.2;

/**
 * Chance a player agrees to re-sign with his team. It depends on him: how loyal he is, and how
 * much winning matters to him (ambition: half to one and a half times the team's pull, so an
 * ambitious player stays with a winner and leaves a loser). Both are centred on the average
 * player, so each kind of team keeps as many players as `RESIGN_CHANCE` says, only not at random.
 * His role is deliberately left out: core players staying more cut playoff turnover below its
 * healthy floor (balance lab, 28.6% against 31%).
 */
export function stayChance(status: TeamStatus, playerId: string): number {
  const { loyalty, ambition } = personalityOf(playerId);
  const winning = (RESIGN_CHANCE[status] - RESIGN_CHANCE.bubble) * (0.5 + ambition);
  const chance = RESIGN_CHANCE.bubble + winning + (loyalty - 0.5) * 2 * LOYALTY_SWING;
  return Math.max(0.05, Math.min(0.95, chance));
}

/** How far below the league's typical rostered player a player may be and still get re-signed. */
const RESIGN_SLACK = 8;

/**
 * Step 3: contracts that ran out make the player a free agent, unless he signed an extension
 * in season: then the extension starts. The team he left (`formerTeams`) tries to re-sign him first.
 */
export function expireContracts(state: LeagueState, ctx: SimContext, emit: Emit): void {
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
    // Young players are restricted: their team keeps the right to match another team's offer.
    const restricted = ageIn(p, state.date.season + 1) < ctx.ruleset.contracts.ufaAge;
    emit('minor', [p.teamId], {
      kind: 'contract.expired',
      playerId: p.id,
      ...(restricted ? { rightsTeamId: p.teamId } : {}),
    });
  }
}

/**
 * Step 5: each team re-signs its own expired players (this summer's `formerTeams`), best first,
 * while it has a roster spot and cap room. Players clearly below the league's typical rostered
 * player walk, unless the team needs that position.
 */
export function reSignPlayers(
  state: LeagueState,
  ctx: SimContext,
  rng: Rng,
  emit: Emit,
  season: number,
) {
  const { ruleset } = ctx;
  const typical = typicalRating(state);
  const expiring = new Map<TeamId, PlayerId[]>();
  for (const [id, teamId] of Object.entries(state.formerTeams)) {
    expiring.set(teamId, [...(expiring.get(teamId) ?? []), id as PlayerId]);
  }

  for (const teamId of [...expiring.keys()].sort()) {
    // A human GM re-signs his own players in the re-sign window; the rest walk.
    const team = state.teams[teamId];
    if (!team || team.userControlled) continue;
    const seen = (p: Player) => overall(seenBy(team, p));
    const candidates = expiring
      .get(teamId)!
      .map((id) => state.players[id])
      .filter((p): p is Player => !!p)
      .sort((a, b) => seen(b) - seen(a) || a.id.localeCompare(b.id));
    for (const p of candidates) {
      const roster = rosterOf(state, teamId);
      if (roster.length >= ruleset.roster.maxActive) break;
      const needed = countAt(roster, p.position) < (ruleset.roster.positionMin[p.position] ?? 0);
      if (!needed && seen(p) < typical - RESIGN_SLACK) continue;
      // A rebuilding team lets its veterans go (unless it needs the position).
      if (!needed && team.plan?.kind === 'rebuild' && ageIn(p, season) >= REBUILD_LETS_GO) continue;
      // Not every player wants to stay: some test the market (and the worst teams pick first).
      const status = planStatus(team, state.teamStatus[teamId] ?? 'bubble');
      if (!rng.chance(stayChance(status, p.id))) continue;
      const contract = offerContract(ruleset, roster, p, season, drawYears(ageIn(p, season), rng), {
        isResign: true,
        discount: false,
        ask: resignAsk(ctx, p, season),
        dead: deadCap(state, teamId, season),
      });
      if (contract) {
        emit('minor', [teamId], {
          kind: 'player.signed',
          playerId: p.id,
          teamId,
          contract,
          staying: true,
        });
      }
    }
  }
}

/** An AI or fill-in signing: he signs if his team has the room (`capRoom`). Whether he signed. */
function signIfRoom(
  state: LeagueState,
  ctx: SimContext,
  emit: Emit,
  pr: Prospect,
  season: number,
): boolean {
  const teamId = pr.player.teamId!;
  const deal = prospectDeal(ctx.ruleset, pr, season);
  const roster = rosterOf(state, teamId);
  if (
    !deal ||
    deal.capHit > capRoom(ctx.ruleset, roster, pr.player, deadCap(state, teamId, season))
  )
    return false;
  emit('minor', [teamId], {
    kind: 'prospect.signed',
    playerId: pr.player.id,
    teamId,
    contract: deal,
  });
  return true;
}

/**
 * Step 5, first: an AI GM signs prospects on his read, before he re-signs anyone (his own kids
 * take the spots first, as draft picks did when they joined the roster on draft day): one who
 * would make the roster now (read overall at least the bar he re-signs his own players at), or
 * one whose rights end this summer and whose read potential (his scouts') clears it. Best first,
 * while he has a roster spot and the cap room. The rest wait, or walk when free agency opens
 * (`releaseProspects`).
 */
export function signProspects(state: LeagueState, ctx: SimContext, emit: Emit, season: number) {
  const bar = typicalRating(state) - RESIGN_SLACK;
  for (const team of Object.values(state.teams).sort((a, b) => a.id.localeCompare(b.id))) {
    if (team.userControlled) continue;
    const seen = (p: Player) => overall(seenBy(team, p));
    const potential = (p: Player) => {
      const r = teamRange(team, { player: p }, ctx, season);
      return (r.low + r.high) / 2;
    };
    const wanted = prospectsOf(state, team.id)
      .filter(
        (x) =>
          seen(x.player) >= bar || (x.rightsEnd <= state.date.season && potential(x.player) >= bar),
      )
      .sort((a, b) => seen(b.player) - seen(a.player) || a.player.id.localeCompare(b.player.id));
    for (const pr of wanted) {
      if (rosterOf(state, team.id).length >= ctx.ruleset.roster.maxActive) break;
      signIfRoom(state, ctx, emit, pr, season);
    }
  }
}

/** Free agency opens: prospects whose rights end this summer, still unsigned, become free agents. */
export function releaseProspects(state: LeagueState, emit: Emit) {
  for (const pr of Object.values(state.prospects).sort((a, b) =>
    a.player.id.localeCompare(b.player.id),
  )) {
    if (pr.rightsEnd > state.date.season) continue;
    const team = state.teams[pr.player.teamId!];
    emit(team?.userControlled ? 'notable' : 'minor', team ? [team.id] : [], {
      kind: 'prospect.released',
      playerId: pr.player.id,
    });
  }
}

/**
 * Step 6: free agency. In rounds, each team below its position or roster minimum signs the
 * best free agent it can afford for what it needs; if the pool has nobody it can afford, its own
 * best prospect there, else a freshly generated undrafted player, so a team is never left short.
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
    const team = state.teams[teamId]!;
    const seen = (p: Player) => (team.userControlled ? overall(p) : overall(seenBy(team, p)));
    const pool = freeAgents(state)
      .filter((p) => position === null || p.position === position)
      .sort((a, b) => seen(b) - seen(a) || a.id.localeCompare(b.id));
    for (const p of pool) {
      const contract = offerContract(ruleset, roster, p, season, drawYears(ageIn(p, season), rng), {
        isResign: false,
        discount: true,
        ask: ctx.models.contractDemand.ask(ruleset, p),
        dead: deadCap(state, teamId, season),
      });
      if (contract) {
        emit('minor', [teamId], { kind: 'player.signed', playerId: p.id, teamId, contract });
        return true;
      }
    }
    const own = prospectsOf(state, teamId)
      .filter((x) => position === null || x.player.position === position)
      .sort((a, b) => seen(b.player) - seen(a.player) || a.player.id.localeCompare(b.player.id));
    if (own.some((x) => signIfRoom(state, ctx, emit, x, season))) return true;
    // Nobody fits: sign an undrafted rookie (generated, so the pool never runs dry).
    const rookie = ctx.sport.generateProspect(rng, {
      id: `u${season}_${undrafted++}`,
      season,
      ...(position ? { position } : {}),
    });
    const contract = entryContract(ruleset, roster, rookie, season, deadCap(state, teamId, season));
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
 * Worst teams go first. This can take a roster past the maximum: until the farm team exists,
 * every signed player counts as rostered.
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
      const dead = deadCap(state, teamId, season);
      const short = ruleset.cap.lowerLimit - payroll(roster) - dead;
      if (short <= 0) break;
      const signed = freeAgents(state)
        .sort(byOverall)
        .some((p) => {
          const contract = offerContract(
            ruleset,
            roster,
            p,
            season,
            drawYears(ageIn(p, season), rng),
            {
              isResign: false,
              discount: false,
              atLeast: short,
              ask: ctx.models.contractDemand.ask(ruleset, p),
              dead,
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
        dead,
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
