import type { Player, TeamId } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import type { SimContext } from '../context';
import { overall } from '../players';
import { capYearOf } from '../cba';
import { GM_LEAN, gmOf, seenBy } from '../people';
import { signFreeAgent, signingInterest } from './signing';
import { capRoom, freeAgents, rosterOf, neededPosition } from './roster';
import { wantedYears } from './freeAgency';

/**
 * The free-agent market: AI teams make offers to free agents (one per team per day), and a free
 * agent picks the offer he likes best (the interest meter) the next day, so you can lose a
 * player you were chasing. Offers are legal when made (`signFreeAgent`) and checked again when
 * he decides, since cap room moves. `fillRosters` still tops up whoever is short afterwards.
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

/** An AI team also keeps a minimum salary free for every slot it still has to fill. */
function aiCanPay(state: LeagueState, ctx: SimContext, p: Player, teamId: TeamId, salary: number) {
  return (
    state.teams[teamId]!.userControlled ||
    salary <= capRoom(ctx.ruleset, rosterOf(state, teamId), p)
  );
}

/** Each free agent with offers signs the best one that still works; the teams that lose are told. */
export function decideOffers(state: LeagueState, ctx: SimContext, emit: Emit): void {
  const byPlayer = new Map<string, typeof state.faOffers>();
  for (const o of state.faOffers)
    byPlayer.set(o.playerId, [...(byPlayer.get(o.playerId) ?? []), o]);
  for (const id of [...byPlayer.keys()].sort()) {
    const player = state.players[id];
    if (!player || player.teamId !== null) continue;
    const offers = byPlayer
      .get(id)!
      .map((o) => ({ o, interest: signingInterest(state, ctx, player, o.teamId, o).interest }))
      .sort((a, b) => b.interest - a.interest || a.o.teamId.localeCompare(b.o.teamId));
    for (const { o } of offers) {
      const deal = signFreeAgent(state, ctx, player, o.teamId, o);
      if ('error' in deal || !aiCanPay(state, ctx, player, o.teamId, o.salary)) continue;
      const losers = offers.map((x) => x.o.teamId).filter((t) => t !== o.teamId);
      emit('minor', [o.teamId, ...losers], {
        kind: 'player.signed',
        playerId: player.id,
        teamId: o.teamId,
        contract: deal.contract,
      });
      for (const teamId of losers) {
        if (!state.teams[teamId]?.userControlled) continue;
        emit('notable', [teamId], {
          kind: 'news.posted',
          headline: 'event.lostFreeAgent',
          params: {
            player: `${player.firstName} ${player.lastName}`,
            team: `${state.teams[o.teamId]!.city} ${state.teams[o.teamId]!.name}`,
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
    if (!short && roster.length >= ruleset.roster.maxActive) continue;
    const plan = team.plan?.kind;
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
      const premium =
        PREMIUMS[rng.int(0, PREMIUMS.length - 1)]! +
        LEAN_PREMIUM * GM_LEAN[gmOf(team).style] +
        (plan === 'contend' ? CONTEND_PREMIUM : 0);
      const salary = Math.round(ask * Math.max(1, premium));
      const years = Math.min(
        wantedYears(season - p.birthYear, rng),
        ruleset.contracts.maxYearsNewTeam,
      );
      if (!aiCanPay(state, ctx, p, teamId, salary)) continue;
      if ('error' in signFreeAgent(state, ctx, p, teamId, { salary, years })) continue;
      emit('minor', [teamId], {
        kind: 'freeAgency.offered',
        offer: { playerId: p.id, teamId, salary, years },
      });
      break;
    }
  }
}

/** One day on the market: free agents answer yesterday's offers, then AI teams make new ones. */
export function marketDay(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  decideOffers(state, ctx, emit);
  makeOffers(state, ctx, rng, emit);
}
