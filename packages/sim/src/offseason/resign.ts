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
import { ageIn, capRoom, drawYears, rosterOf, resignAsk } from './roster';

/**
 * The re-sign window: during the season (an extension that starts next season) and after the
 * champion is crowned until free agency opens, a team may sign its players whose contracts end
 * this season. Not during the playoffs. His ask is the market salary (less the RFA discount for a
 * restricted player, `resignAsk`); a human team negotiates through the signing meter (his line,
 * his agent's counter), an AI team re-signs at the ask. The cap advisor shows what a deal would do
 * to each season; only CBA contract rules (term, minimum, maximum) can refuse a deal, never the cap.
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

/**
 * The contract for re-signing `player` on this offer from next season, or why it is illegal (the
 * CBA's terms only: whether he wants it is the meter's call, `signingInterest` with `resign`).
 */
export function resignContract(
  state: LeagueState,
  ctx: SimContext,
  player: Player,
  offer: { salary: number; years: number; noTrade?: true; bonusPct?: number },
): { contract: Contract } | { issues: ContractIssue[] } {
  const season = state.date.season + 1;
  const capHit = Math.round(offer.salary);
  const { years, noTrade, bonusPct } = offer;
  const issues = validateContract(ctx.ruleset, {
    // A fractional or NaN term (or a NaN salary) would throw or slip through; it is empty instead.
    salaries: Array<number>(
      Number.isInteger(years) && Number.isFinite(capHit) ? Math.max(0, years) : 0,
    ).fill(capHit),
    signingAge: ageIn(player, season),
    isResign: true,
    ...(bonusPct !== undefined && { bonusPct }),
    ...(noTrade && {
      noTrade: {
        held: rosterOf(state, player.teamId!).filter(
          (p) => p.id !== player.id && p.contract?.noTrade,
        ).length,
      },
    }),
  });
  return issues.length > 0
    ? { issues }
    : {
        contract: {
          capHit,
          expiresAfterSeason: season + years - 1,
          ...(noTrade && { noTrade }),
          ...(bonusPct && { bonus: Math.round((capHit * bonusPct) / 100) }),
        },
      };
}

export { expiring as isExpiring };

/**
 * An AI GM settles a holdout by paying him: the extension he asks for, once his deal is in its
 * last season and the raise fits next season's cap. A win-now GM pays; a balanced one pays if he
 * is good at the job; a builder (or anyone without the room) waits him out (`holdoutsWeek`). A
 * builder, or a balanced GM not good enough to pay, shops him instead: he goes on the trade block
 * (where AI buyers call, `aiTrades`) rather than sitting out the year.
 */
export function aiHoldouts(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  for (const h of [...state.holdouts].sort((a, b) => a.playerId.localeCompare(b.playerId))) {
    const team = state.teams[h.teamId]!;
    if (team.userControlled) continue;
    const { style, skill } = gmOf(team);
    if (style === 'builder' || (style === 'balanced' && skill < 0.5)) {
      if (!state.tradeBlock.includes(h.playerId)) {
        emit('minor', [team.id], {
          kind: 'trade.blockSet',
          teamId: team.id,
          playerId: h.playerId,
          onBlock: true,
        });
      }
      continue;
    }
    const offer = resignOffers(state, ctx, team.id).find((o) => o.playerId === h.playerId);
    if (!offer || offer.issues[0]!.length > 0) continue;
    const p = state.players[h.playerId]!;
    const years = drawYears(ageIn(p, state.date.season + 1), rng);
    const deal = resignContract(state, ctx, p, { salary: offer.ask, years });
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
