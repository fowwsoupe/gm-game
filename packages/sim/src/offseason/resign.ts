import type { Contract, Player, ResignOffer, TeamId } from '@gm/shared';
import type { LeagueState } from '../core';
import { capIssues, capSheet, validateContract, type ContractIssue } from '../cba';
import type { SimContext } from '../context';
import { ageIn, rosterOf } from './roster';

/**
 * The re-sign window: after the champion is crowned and before the rollover, a team may sign
 * its players whose contracts end this season. Negotiation is a flat ask for v0.1: the market
 * salary, any term the CBA allows. The cap advisor shows what a deal would do to each season;
 * only CBA contract rules (term, minimum, maximum) can refuse a deal, never the cap.
 */

const expiring = (state: LeagueState, p: Player) =>
  p.contract !== undefined && p.contract.expiresAfterSeason <= state.date.season;

/** What each expiring player on `teamId` asks, and how his deal would affect the team's cap. */
export function resignOffers(state: LeagueState, ctx: SimContext, teamId: TeamId): ResignOffer[] {
  if (!state.championTeamId) return [];
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
  return rosterOf(state, teamId)
    .filter((p) => expiring(state, p))
    .map((p) => {
      const ask = ctx.models.contractDemand.ask(ruleset, p);
      return {
        playerId: p.id,
        ask,
        maxYears: ruleset.contracts.maxYearsResign,
        issues: sheet.seasons.map((s, i) =>
          capIssues(ruleset, s.total + ask, i === 0 ? 'offseason' : 'future'),
        ),
      };
    });
}

/** The contract for re-signing `player` for `years` starting next season, or why it is illegal. */
export function resignContract(
  state: LeagueState,
  ctx: SimContext,
  player: Player,
  years: number,
): { contract: Contract } | { issues: ContractIssue[] } {
  const season = state.date.season + 1;
  const capHit = ctx.models.contractDemand.ask(ctx.ruleset, player);
  const issues = validateContract(ctx.ruleset, {
    salaries: Array<number>(Math.max(0, years)).fill(capHit),
    signingAge: ageIn(player, season),
    isResign: true,
  });
  return issues.length > 0
    ? { issues }
    : { contract: { capHit, expiresAfterSeason: season + years - 1 } };
}

export { expiring as isExpiring };
