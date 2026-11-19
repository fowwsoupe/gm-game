import type { FreeAgentOffer, Player, Team, TeamId } from '@gm/shared';
import { playerName, teamName, type Emit, type LeagueState, type Rng } from '../core';
import type { SimContext } from '../context';
import { overall } from '../players';
import { buyoutCharges, capYearIssues, capYearOf, deadCap, teamCapTotal } from '../cba';
import { GM_LEAN, gmOf, seenBy } from '../people';
import { compensationFor, signFreeAgent, signingInterest } from './signing';
import { capRoom, countAt, drawYears, freeAgents, rosterOf, neededPosition } from './roster';
import { CORE } from './gms';

/**
 * The free-agent market: AI teams make offers to free agents (one per team per day), and a free
 * agent picks the offer he likes best (the interest meter), so you can lose a player you were
 * chasing. With one team bidding he answers the next market day; with two or more he waits
 * `freeAgency.days` market days after his first offer while the trailing AI teams raise (a
 * bidding war). Offers are legal when made (`signFreeAgent`) and checked again when he decides,
 * since cap room moves. `fillRosters` still tops up whoever is short afterwards.
 */

/** Days of AI offers in a summer, once the human GM is done (`finishRollover`). */
export const MARKET_DAYS = 5;

/** A team with a full-enough roster only goes after a clear upgrade at the position. */
const UPGRADE_MARGIN = 3;
/** A contender chases smaller upgrades and pays this much more again. */
const CONTEND_MARGIN = 1;
const CONTEND_PREMIUM = 0.05;
/** A rebuilding team signs nobody older than this unless it is short. */
const REBUILD_MAX_AGE = 27;

/** Asking price times this is what an AI team offers (some pay a little over to win him). */
const PREMIUMS = [1, 1.05, 1.1, 1.15];
/** A win-now GM pays this much more again; a builder this much less. */
const LEAN_PREMIUM = 0.08;
/** On top of any premium: the GM's lean, and more again for a contender. */
const tilt = (team: Team) =>
  LEAN_PREMIUM * GM_LEAN[gmOf(team).style] + (team.plan?.kind === 'contend' ? CONTEND_PREMIUM : 0);

/** The most an AI team pays a free agent who asks `ask`: about 1.33x for a win-now contender, 1.12x for a builder. */
export function walkAway(state: LeagueState, ctx: SimContext, teamId: TeamId, ask: number) {
  return Math.round(ask * (ctx.ruleset.freeAgency.maxPremium + tilt(state.teams[teamId]!)));
}

/** A signing after this many teams bid makes the news as a bidding war. */
const BIDDING_WAR = 3;

/** Depth players a contender lets go, at most, to make room for one free agent. */
const MAX_LET_GO = 2;

/**
 * Whether an AI team can take `p` for `salary`: a roster spot, and cap room with a minimum
 * salary kept free for every slot it still has to fill. `let go: []` if it can as it is. If it
 * cannot, a contender makes room for a player who would join its core by buying out up to
 * two depth players (worse than him, outside the core, not needed at their position): the
 * lowest-rated for a roster spot, the one that frees the most cap for money. `freed`: cap
 * this frees in the cap year, net of the buyouts' dead cap. Null: no room, none made.
 */
export function roomFor(
  state: LeagueState,
  ctx: SimContext,
  teamId: TeamId,
  p: Player,
  salary: number,
): { letGo: Player[]; freed: number } | null {
  const { ruleset } = ctx;
  const team = state.teams[teamId]!;
  // A human team's offers are checked by `signFreeAgent` alone; it makes its own room.
  if (team.userControlled) return { letGo: [], freed: 0 };
  const year = capYearOf(state);
  let roster = rosterOf(state, teamId);
  let dead = deadCap(state, teamId, year);
  const fits = () =>
    roster.length < ruleset.roster.maxActive && salary <= capRoom(ruleset, roster, p, dead);
  if (fits()) return { letGo: [], freed: 0 };
  if (team.plan?.kind !== 'contend') return null;
  const seen = (x: Player) => overall(seenBy(team, x));
  const ranked = [...roster].sort((a, b) => seen(b) - seen(a) || a.id.localeCompare(b.id));
  if (ranked.length >= CORE && seen(p) < seen(ranked[CORE - 1]!)) return null;
  const charges = (x: Player) =>
    buyoutCharges(ruleset, { teamId, player: x, season: state.date.season });
  const charge = (x: Player) =>
    charges(x)
      .filter((c) => c.season === year)
      .reduce((sum, c) => sum + c.amount, 0);
  const freedBy = (x: Player) => (x.contract?.capHit ?? 0) - charge(x);
  const letGo: Player[] = [];
  let freed = 0;
  while (!fits()) {
    if (letGo.length >= MAX_LET_GO) return null;
    const depth = ranked
      .slice(CORE)
      .filter(
        (x) =>
          roster.includes(x) &&
          seen(x) < seen(p) &&
          charges(x).length > 0 &&
          countAt([...roster, p], x.position) > (ruleset.roster.positionMin[x.position] ?? 0),
      );
    const spot = roster.length >= ruleset.roster.maxActive;
    const pick = spot
      ? depth.at(-1) // ranked best first: the last is the lowest-rated
      : [...depth].sort((a, b) => freedBy(b) - freedBy(a))[0];
    if (!pick) return null;
    letGo.push(pick);
    freed += freedBy(pick);
    dead += charge(pick);
    roster = roster.filter((x) => x !== pick);
  }
  return { letGo, freed };
}

/** A contender buys out the players `roomFor` picked (in the summer, so no proration). */
function letGo(state: LeagueState, ctx: SimContext, emit: Emit, teamId: TeamId, players: Player[]) {
  const team = state.teams[teamId]!;
  for (const x of players) {
    emit('minor', [teamId], {
      kind: 'contract.boughtOut',
      playerId: x.id,
      teamId,
      charges: buyoutCharges(ctx.ruleset, { teamId, player: x, season: state.date.season }),
    });
    emit('notable', [teamId], {
      kind: 'news.posted',
      headline: 'event.madeRoom',
      playerId: x.id,
      params: { team: teamName(team), player: playerName(x) },
    });
  }
}

/** An AI team matches an offer sheet for its restricted free agent when it is fair and it has room. */
const MATCH_PREMIUM = 1.15;
function aiMatches(state: LeagueState, ctx: SimContext, teamId: TeamId, p: Player, salary: number) {
  if (salary > ctx.models.contractDemand.ask(ctx.ruleset, p) * MATCH_PREMIUM) return null;
  const room = roomFor(state, ctx, teamId, p, salary);
  if (!room) return null;
  return capYearIssues(ctx.ruleset, state, teamCapTotal(state, teamId) + salary - room.freed)
    .length === 0
    ? room
    : null;
}

/**
 * A sheet that stands (declined, or nobody answered): he signs with the team that sent it, making
 * room the way an offer does (`roomFor`), or the sheet is dropped if that no longer works.
 */
export function acceptSheet(
  state: LeagueState,
  ctx: SimContext,
  emit: Emit,
  sheet: FreeAgentOffer,
) {
  const player = state.players[sheet.playerId];
  const room = player && roomFor(state, ctx, sheet.teamId, player, sheet.salary);
  const deal = player && room && signFreeAgent(state, ctx, player, sheet.teamId, sheet, room.freed);
  if (!player || !room || !deal || 'error' in deal) {
    emit('minor', [sheet.teamId], { kind: 'freeAgency.sheetDropped', playerId: sheet.playerId });
    return;
  }
  letGo(state, ctx, emit, sheet.teamId, room.letGo);
  const rights = state.rfaRights[player.id];
  emit('minor', rights ? [sheet.teamId, rights] : [sheet.teamId], {
    kind: 'player.signed',
    playerId: player.id,
    teamId: sheet.teamId,
    contract: deal.contract,
    ...compensationFor(state, ctx.ruleset, player, sheet.teamId, deal.contract.capHit),
  });
}

/** Sheets nobody answered stand. */
function settleSheets(state: LeagueState, ctx: SimContext, emit: Emit): void {
  for (const sheet of [...state.rfaSheets]) acceptSheet(state, ctx, emit, sheet);
}

/** Free agents with an offer on the table, by id. */
const bidFor = (state: LeagueState) => [...new Set(state.faOffers.map((o) => o.playerId))].sort();

/**
 * The offers to `player`, the one he likes best first (ties by team id), and the market day he
 * decides: the day after his first offer, or `freeAgency.days` after it with two or more teams
 * bidding (a team has one offer at most; a raise replaces it).
 */
export function raceFor(state: LeagueState, ctx: SimContext, player: Player) {
  const offers = state.faOffers.filter((o) => o.playerId === player.id);
  const ranked = offers
    .map((o) => ({ o, interest: signingInterest(state, ctx, player, o.teamId, o).interest }))
    .sort((a, b) => b.interest - a.interest || a.o.teamId.localeCompare(b.o.teamId));
  const first = Math.min(...offers.map((o) => o.since ?? 0));
  return { ranked, decides: first + (offers.length > 1 ? ctx.ruleset.freeAgency.days : 1) };
}

/**
 * Each free agent whose decision day has come (every one with `closeAll`, the summer's last call)
 * signs the best offer that still works; the teams that lose are told.
 */
export function decideOffers(
  state: LeagueState,
  ctx: SimContext,
  emit: Emit,
  closeAll = false,
): void {
  settleSheets(state, ctx, emit);
  for (const id of bidFor(state)) {
    const player = state.players[id];
    if (!player || player.teamId !== null) continue;
    const { ranked: offers, decides } = raceFor(state, ctx, player);
    if (!closeAll && state.marketDay < decides) continue;
    for (const { o } of offers) {
      const room = roomFor(state, ctx, o.teamId, player, o.salary);
      if (!room) continue;
      const deal = signFreeAgent(state, ctx, player, o.teamId, o, room.freed);
      if ('error' in deal) continue;
      // An offer sheet to a restricted free agent: his own team may match it.
      const rights = state.rfaRights[player.id];
      if (rights && rights !== o.teamId) {
        if (state.teams[rights]?.userControlled) {
          emit('notable', [rights, o.teamId], { kind: 'freeAgency.sheetReceived', offer: o });
          break;
        }
        const matchRoom = aiMatches(state, ctx, rights, player, o.salary);
        if (matchRoom) {
          letGo(state, ctx, emit, rights, matchRoom.letGo);
          emit('minor', [rights, o.teamId], {
            kind: 'player.signed',
            playerId: player.id,
            teamId: rights,
            contract: deal.contract,
            staying: true,
          });
          break;
        }
      }
      letGo(state, ctx, emit, o.teamId, room.letGo);
      const losers = offers.map((x) => x.o.teamId).filter((t) => t !== o.teamId);
      emit('minor', [o.teamId, ...losers], {
        kind: 'player.signed',
        playerId: player.id,
        teamId: o.teamId,
        contract: deal.contract,
        ...compensationFor(state, ctx.ruleset, player, o.teamId, deal.contract.capHit),
      });
      if (offers.length >= BIDDING_WAR) {
        emit('notable', [o.teamId, ...losers], {
          kind: 'news.posted',
          headline: 'event.biddingWar',
          params: {
            player: playerName(player),
            team: teamName(state.teams[o.teamId]!),
            n: offers.length,
          },
        });
      }
      for (const teamId of losers) {
        if (!state.teams[teamId]?.userControlled) continue;
        emit('notable', [teamId], {
          kind: 'news.posted',
          headline: 'event.lostFreeAgent',
          playerId: player.id,
          params: {
            player: playerName(player),
            team: teamName(state.teams[o.teamId]!),
          },
        });
      }
      break;
    }
  }
}

/** Each AI team with a need offers its best-rated free agent who would take it. */
function makeOffers(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  const { ruleset } = ctx;
  const season = capYearOf(state);
  for (const teamId of (Object.keys(state.teams) as TeamId[]).sort()) {
    const team = state.teams[teamId]!;
    if (team.userControlled) continue;
    // Each GM ranks the pool (and his own roster) as he sees them.
    const seen = (p: Player) => overall(seenBy(team, p));
    const pool = freeAgents(state).sort((a, b) => seen(b) - seen(a) || a.id.localeCompare(b.id));
    const roster = rosterOf(state, teamId);
    const needed = neededPosition(ruleset, roster);
    const short = needed !== null || roster.length < ruleset.roster.minActive;
    const plan = team.plan?.kind;
    // A full roster stays out of the market, unless a contender makes room for a star (`roomFor`).
    if (!short && roster.length >= ruleset.roster.maxActive && plan !== 'contend') continue;
    const wants = (p: Player) => {
      if (needed !== null) return p.position === needed;
      if (short) return true;
      if (plan === 'rebuild' && season - p.birthYear > REBUILD_MAX_AGE) return false;
      const worst = Math.min(
        ...roster.filter((r) => r.position === p.position).map(seen),
        Infinity,
      );
      return seen(p) >= worst + (plan === 'contend' ? CONTEND_MARGIN : UPGRADE_MARGIN);
    };
    for (const p of pool) {
      if (p.teamId !== null || !wants(p)) continue;
      if (state.faOffers.some((o) => o.playerId === p.id && o.teamId === teamId)) continue;
      const ask = ctx.models.contractDemand.ask(ruleset, p);
      const premium = PREMIUMS[rng.int(0, PREMIUMS.length - 1)]! + tilt(team);
      const salary = Math.round(ask * Math.max(1, premium));
      const years = Math.min(
        drawYears(season - p.birthYear, rng),
        ruleset.contracts.maxYearsNewTeam,
      );
      const room = roomFor(state, ctx, teamId, p, salary);
      if (!room) continue;
      if ('error' in signFreeAgent(state, ctx, p, teamId, { salary, years }, room.freed)) continue;
      emit('minor', [teamId], {
        kind: 'freeAgency.offered',
        offer: { playerId: p.id, teamId, salary, years },
      });
      break;
    }
  }
}

/**
 * Each AI team trailing in an open race raises its offer by `freeAgency.raiseStep` of his ask,
 * once a day, while that lifts his interest, stays at or under its walk-away and is still legal
 * (`roomFor`, `signFreeAgent`). No random numbers.
 */
function raiseOffers(state: LeagueState, ctx: SimContext, emit: Emit): void {
  for (const id of bidFor(state)) {
    const player = state.players[id];
    if (!player || player.teamId !== null) continue;
    const ask = ctx.models.contractDemand.ask(ctx.ruleset, player);
    for (const { o, interest } of raceFor(state, ctx, player).ranked.slice(1)) {
      if (state.teams[o.teamId]?.userControlled) continue;
      const salary = o.salary + Math.round(ask * ctx.ruleset.freeAgency.raiseStep);
      if (salary > walkAway(state, ctx, o.teamId, ask)) continue;
      const offer = { playerId: player.id, teamId: o.teamId, salary, years: o.years };
      if (signingInterest(state, ctx, player, o.teamId, offer).interest <= interest) continue;
      const room = roomFor(state, ctx, o.teamId, player, salary);
      if (!room || 'error' in signFreeAgent(state, ctx, player, o.teamId, offer, room.freed)) {
        continue;
      }
      emit('minor', [o.teamId], { kind: 'freeAgency.offered', offer });
    }
  }
}

/**
 * One day on the market: the day turns, free agents whose day has come decide, trailing AI teams
 * raise, then AI teams make new offers.
 */
export function marketDay(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  emit('minor', [], { kind: 'freeAgency.dayPassed', day: state.marketDay + 1 });
  decideOffers(state, ctx, emit);
  raiseOffers(state, ctx, emit);
  makeOffers(state, ctx, rng, emit);
}
