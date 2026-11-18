import type { Contract, Player, ResignOffer, TeamId } from '@gm/shared';
import { phaseOf, type Emit, type LeagueState, type Rng } from '../core';
import {
  capIssues,
  capSheet,
  contractIn,
  deadCap,
  validateContract,
  type ContractIssue,
} from '../cba';
import type { SimContext } from '../context';
import { gmOf } from '../people';
import { drawYears } from './freeAgency';
import { ageIn, capRoom, rosterOf, resignAsk } from './roster';

/**
 * The re-sign window: during the season (an extension that starts next season) and after the
 * champion is crowned until free agency opens, a team may sign its players whose contracts end
 * this season. Not during the playoffs. Negotiation is a flat ask for v0.1: the market
 * salary (less the RFA discount for a restricted player, `resignAsk`), any term the CBA allows. The cap advisor shows what a deal would do to each season;
 * only CBA contract rules (term, minimum, maximum) can refuse a deal, never the cap.
 */

const expiring = (state: LeagueState, p: Player) =>
  p.contract !== undefined && p.contract.expiresAfterSeason <= state.date.season && !p.extension;

/** Re-signing is open: in season (extensions) and once the champion is crowned, not in the playoffs. */
export const resignWindowOpen = (state: LeagueState, ctx: SimContext) =>
  state.championTeamId !== null || phaseOf(ctx.ruleset.season.calendar, state.date) !== 'playoffs';

/** What each expiring player on `teamId` asks, and how his deal would affect the team's cap. */
export function resignOffers(state: LeagueState, ctx: SimContext, teamId: TeamId): ResignOffer[] {
  if (!resignWindowOpen(state, ctx)) return [];
  const { ruleset } = ctx;
  const season = state.date.season + 1;
  const sheet = capSheet(ruleset, {
    teamId,
    players: Object.values(state.players),
    charges: state.capCharges,
    fromSeason: season,
    years: ruleset.contracts.maxYearsResign,
    phase: 'offseason',
  });
  return (
    rosterOf(state, teamId)
      // A player who asked out will not re-sign until that is settled.
      .filter((p) => expiring(state, p) && !state.tradeRequests.some((r) => r.playerId === p.id))
      .map((p) => {
        const ask = resignAsk(ctx, p, season);
        return {
          playerId: p.id,
          ask,
          maxYears: ruleset.contracts.maxYearsResign,
          issues: sheet.seasons.map((s, i) =>
            capIssues(ruleset, s.total + ask, i === 0 ? 'offseason' : 'future'),
          ),
        };
      })
  );
}

/** The contract for re-signing `player` for `years` starting next season, or why it is illegal. */
export function resignContract(
  state: LeagueState,
  ctx: SimContext,
  player: Player,
  years: number,
): { contract: Contract } | { issues: ContractIssue[] } {
  const season = state.date.season + 1;
  const capHit = resignAsk(ctx, player, season);
  const issues = validateContract(ctx.ruleset, {
    // A fractional or NaN term would throw in Array(); it is empty instead (refused).
    salaries: Array<number>(Number.isInteger(years) ? Math.max(0, years) : 0).fill(capHit),
    signingAge: ageIn(player, season),
    isResign: true,
  });
  return issues.length > 0
    ? { issues }
    : { contract: { capHit, expiresAfterSeason: season + years - 1 } };
}

export { expiring as isExpiring };

/**
 * An AI GM settles a holdout by paying him: the extension he asks for, once his deal is in its
 * last season and the raise fits next season's cap. A win-now GM pays; a balanced one pays if he
 * is good at the job; a builder (or anyone without the room) waits him out (`holdoutsWeek`).
 */
export function aiHoldouts(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  for (const h of [...state.holdouts].sort((a, b) => a.playerId.localeCompare(b.playerId))) {
    const team = state.teams[h.teamId]!;
    if (team.userControlled) continue;
    const { style, skill } = gmOf(team);
    if (style === 'builder' || (style === 'balanced' && skill < 0.5)) continue;
    const offer = resignOffers(state, ctx, team.id).find((o) => o.playerId === h.playerId);
    if (!offer || offer.issues[0]!.length > 0) continue;
    const p = state.players[h.playerId]!;
    const deal = resignContract(state, ctx, p, drawYears(ageIn(p, state.date.season + 1), rng));
    if ('issues' in deal) continue;
    // The raise must leave room to fill next season's roster at the minimum, as a signing must.
    const next = state.date.season + 1;
    const signed = rosterOf(state, team.id).flatMap((x) => {
      const c = x.id === p.id ? undefined : contractIn(x, next);
      return c ? [{ ...x, contract: c }] : [];
    });
    if (deal.contract.capHit > capRoom(ctx.ruleset, signed, p, deadCap(state, team.id, next))) {
      continue;
    }
    emit('notable', [team.id], {
      kind: 'contract.extended',
      playerId: p.id,
      teamId: team.id,
      contract: deal.contract,
    });
  }
}
