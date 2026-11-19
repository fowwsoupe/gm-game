import type { Contract, Player, PlayerId, SigningInterest, TeamId, TeamStatus } from '@gm/shared';
import type { EventBody, LeagueState } from '../core';
import {
  capYearIssues,
  capYearOf,
  maxPlayerCapHit,
  teamCapTotal,
  validateContract,
  type Ruleset,
} from '../cba';
import { nextDraftSeason, pickId, pickOwner } from '../league';
import { overall } from '../players';
import { hometownOf, personalityOf } from '../people';
import type { SimContext } from '../context';
import { resignWindowOpen } from './resign';
import { resignAsk, wantedYears } from './roster';

/**
 * Free agency: a free agent weighs an offer on money, winning, his role and the term, with
 * weights that shift with age (young players chase money and ice time, veterans a winner).
 * Greed and ambition (people engine) tilt those weights. He signs when his interest reaches his
 * line (`lineOf`, hidden from the GM); under it his agent counters (`counterOffer`) until his
 * patience runs out. A re-sign (`resign`) is weighed the same way, from his re-sign ask, with his
 * loyalty counted for the team he plays for.
 */

/** An offer as the meter weighs it; `resign`: his own team re-signing him. */
type Offer = { salary: number; years: number; noTrade?: true; bonusPct?: number; resign?: true };

/** `signFreeAgent`'s answer to a legal offer under his line. */
export const NOT_INTERESTED = 'he is not interested';

/** The interest he signs at: the ruleset's line, up to `lineSwing` higher for the greediest player. */
export const lineOf = (ctx: SimContext, playerId: string) => {
  const { line, lineSwing } = ctx.ruleset.freeAgency;
  return Math.round(line + (personalityOf(playerId).greed - 0.5) * 2 * lineSwing);
};

/** Rounds of talks `teamId` has left with him: his patience (more for a calm player) until spent. */
export const talksLeft = (
  state: LeagueState,
  ctx: SimContext,
  playerId: PlayerId,
  teamId: TeamId,
) =>
  state.talks[playerId]?.[teamId] ??
  1 + Math.round(ctx.ruleset.freeAgency.patience * personalityOf(playerId).temperament);

const WINNING: Record<TeamStatus, number> = {
  contender: 1,
  buyer: 0.8,
  bubble: 0.6,
  seller: 0.35,
  rebuilder: 0.2,
  crisis: 0.1,
};

/** What a player of this age cares about (weights sum to 1). */
function byAge(age: number) {
  if (age < 26) return { money: 0.4, winning: 0.15, role: 0.35, term: 0.1 };
  if (age < 32) return { money: 0.4, winning: 0.3, role: 0.15, term: 0.15 };
  return { money: 0.25, winning: 0.45, role: 0.1, term: 0.2 };
}

/** Age sets the base; greed leans toward money, ambition toward winning (weights still sum to 1). */
function priorities(age: number, playerId: string) {
  const { greed, ambition } = personalityOf(playerId);
  const w = byAge(age);
  const tilted = {
    money: w.money * (0.7 + 0.6 * greed),
    winning: w.winning * (0.7 + 0.6 * ambition),
    role: w.role,
    term: w.term,
  };
  const total = tilted.money + tilted.winning + tilted.role + tilted.term;
  return {
    money: tilted.money / total,
    winning: tilted.winning / total,
    role: tilted.role / total,
    term: tilted.term / total,
  };
}

/** Most of his weight a pull to the team he left (scaled by loyalty) or to his hometown can take. */
const LOYALTY_PULL = 0.2;
const HOME_PULL = 0.1;
/** The money score tops out here (an overpay); under it, it is linear in salary. */
const MAX_MONEY = 1.5;
/** His agent counters in round numbers. */
const COUNTER_STEP = 10_000;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const KEYS = ['money', 'winning', 'role', 'term'] as const;

/** The meter's parts: his ask, each factor's score and weight, the pulls, and his interest (0-1). */
function weigh(state: LeagueState, ctx: SimContext, player: Player, teamId: TeamId, offer: Offer) {
  const { ruleset } = ctx;
  const season = offer.resign ? state.date.season + 1 : capYearOf(state);
  const age = season - player.birthYear;
  const ask = offer.resign
    ? resignAsk(ctx, player, season)
    : ctx.models.contractDemand.ask(ruleset, player);
  const better = Object.values(state.players).filter(
    (p) => p.teamId === teamId && p.position === player.position && overall(p) > overall(player),
  ).length;
  const depth = (ruleset.roster.positionMin[player.position] ?? 2) + 1;
  const scores = {
    // Asking price = 1; up to 1.5 for an overpay, 0 at 60% of the ask.
    // Cash up front is worth a tenth more than the same money spread over the season.
    money: clamp(
      ((offer.salary * (1 + (0.1 * (offer.bonusPct ?? 0)) / 100)) / ask - 0.6) / 0.4,
      0,
      MAX_MONEY,
    ),
    winning: WINNING[state.teamStatus[teamId] ?? 'bubble'],
    role: clamp(1 - better / depth, 0.2, 1),
    // A no-trade clause is job security: worth about a quarter of the term he wants.
    term: clamp(offer.years / wantedYears(age) + (offer.noTrade ? 0.25 : 0), 0, 1),
  };
  // Playing for his old team or his hometown is worth something on top: a full-score factor that
  // takes its weight from the others, so the same money goes further there (a "discount").
  const pulls: { key: 'loyalty' | 'home'; weight: number }[] = [];
  if ((offer.resign ? player.teamId : state.formerTeams[player.id]) === teamId) {
    pulls.push({
      key: 'loyalty',
      weight: LOYALTY_PULL * (0.25 + 0.75 * personalityOf(player.id).loyalty),
    });
  }
  if (hometownOf(player.id, Object.keys(state.teams)) === teamId) {
    pulls.push({ key: 'home', weight: HOME_PULL });
  }
  const pull = pulls.reduce((sum, x) => sum + x.weight, 0);
  const base = priorities(age, player.id);
  const weights = {
    money: base.money * (1 - pull),
    winning: base.winning * (1 - pull),
    role: base.role * (1 - pull),
    term: base.term * (1 - pull),
  };
  const interest = KEYS.reduce((sum, k) => sum + scores[k] * weights[k], 0) + pull; // pulls score 1
  return { ask, scores, weights, pulls, interest };
}

/** How `player` feels about joining `teamId` for `salary` a year over `years` (or re-signing). */
export function signingInterest(
  state: LeagueState,
  ctx: SimContext,
  player: Player,
  teamId: TeamId,
  offer: Offer,
): SigningInterest {
  const { ruleset } = ctx;
  const { ask, scores, weights, pulls, interest } = weigh(state, ctx, player, teamId, offer);
  const sheet = sheetCompensation(state, ruleset, player, teamId, Math.round(offer.salary));
  return {
    ...(sheet.picks.length && { sheet }),
    playerId: player.id,
    ask,
    maxYears: offer.resign ? ruleset.contracts.maxYearsResign : ruleset.contracts.maxYearsNewTeam,
    interest: Math.round(clamp(interest, 0, 1) * 100),
    talks: talksLeft(state, ctx, player.id, teamId),
    factors: [
      ...KEYS.map((key) => ({
        key,
        score: Math.round(clamp(scores[key], 0, 1) * 100),
        weight: weights[key],
      })),
      ...pulls.map((x) => ({ key: x.key, score: 100, weight: x.weight })),
    ],
  };
}

/**
 * What his agent asks for: the lowest salary, at the offer's term, clause and bonus, that puts his
 * interest at his line plus the agent's markup (more for a greedy player). Null when no salary up
 * to the CBA maximum gets there (a winner-chasing veteran and a rebuilding team).
 */
export function counterSalary(
  state: LeagueState,
  ctx: SimContext,
  player: Player,
  teamId: TeamId,
  offer: Offer,
): number | null {
  const { ask, scores, weights, interest } = weigh(state, ctx, player, teamId, offer);
  const { markup } = ctx.ruleset.freeAgency;
  const target =
    (lineOf(ctx, player.id) + Math.round(personalityOf(player.id).greed * markup)) / 100;
  // The money score is linear in salary up to MAX_MONEY: solve for the one that reaches the target.
  const score = (target - interest + scores.money * weights.money) / weights.money;
  const perDollar = 1 + (offer.bonusPct ?? 0) / 1000; // the bonus's tenth more, as in `weigh`
  const salary = Math.max(
    ctx.ruleset.cap.minSalary,
    Math.ceil((ask * (0.6 + 0.4 * score)) / perDollar / COUNTER_STEP) * COUNTER_STEP,
  );
  return score <= MAX_MONEY && salary <= maxPlayerCapHit(ctx.ruleset) ? salary : null;
}

/**
 * His agent's answer to an offer under his line: a lowball (more than `freeAgency.lowball` under
 * it) spends two rounds of talks, any other offer one. While talks go on he names his counter or,
 * if no salary would do, the factor holding him back (his weakest besides the money).
 */
export function counterOffer(
  state: LeagueState,
  ctx: SimContext,
  player: Player,
  teamId: TeamId,
  offer: Offer,
): Extract<EventBody, { kind: 'contract.countered' }> {
  const view = signingInterest(state, ctx, player, teamId, offer);
  const under = lineOf(ctx, player.id) - view.interest;
  const rounds = Math.max(0, view.talks - (under > ctx.ruleset.freeAgency.lowball ? 2 : 1));
  const base = { kind: 'contract.countered' as const, playerId: player.id, teamId, rounds };
  if (rounds === 0) return base;
  const counter = counterSalary(state, ctx, player, teamId, offer);
  if (counter !== null) return { ...base, counter };
  const score = (key: string) => view.factors.find((f) => f.key === key)!.score;
  const holdsBack = (['winning', 'role', 'term'] as const).reduce((a, b) =>
    score(b) < score(a) ? b : a,
  );
  return { ...base, holdsBack };
}

/**
 * The draft picks `teamId` gives up if its offer sheet at `capHit` signs `player` away from the
 * team holding his rights (`ruleset.contracts.offerSheetCompensation`), none when it costs
 * nothing or he is not restricted, and whether the team owns them all (it must, to send it).
 */
export function sheetCompensation(
  state: LeagueState,
  rules: Ruleset,
  player: Player,
  teamId: TeamId,
  capHit: number,
): { picks: string[]; owned: boolean } {
  const rights = state.rfaRights[player.id];
  if (!rights || rights === teamId) return { picks: [], owned: true };
  const tier = rules.contracts.offerSheetCompensation.filter((t) => capHit >= t.minCapHit).at(-1);
  const first = nextDraftSeason(state);
  const taken = new Map<number, number>();
  const picks = (tier?.rounds ?? []).map((round) => {
    const n = taken.get(round) ?? 0;
    taken.set(round, n + 1);
    return pickId(first + n, round, teamId);
  });
  return { picks, owned: picks.every((id) => pickOwner(state, id, teamId) === teamId) };
}

/** The `player.signed` field for a sheet that stands: his old team's picks, if any. */
export function compensationFor(
  state: LeagueState,
  rules: Ruleset,
  player: Player,
  teamId: TeamId,
  capHit: number,
): { compensation?: { toTeamId: TeamId; picks: string[] } } {
  const { picks, owned } = sheetCompensation(state, rules, player, teamId, capHit);
  const toTeamId = state.rfaRights[player.id];
  return owned && picks.length && toTeamId ? { compensation: { toTeamId, picks } } : {};
}

/**
 * The contract if `player` signs with `teamId` on this offer, or why not. Legal (window, free
 * agent, CBA terms, cap) first, then it has to reach his line (`NOT_INTERESTED`).
 */
export function signFreeAgent(
  state: LeagueState,
  ctx: SimContext,
  player: Player,
  teamId: TeamId,
  offer: { salary: number; years: number; noTrade?: true; bonusPct?: number },
  /** Cap the team will free before he signs (a contender making room, `roomFor`). */
  capFreed = 0,
): { contract: Contract } | { error: string } {
  const { ruleset } = ctx;
  if (player.teamId !== null) return { error: 'not a free agent' };
  if (!resignWindowOpen(state, ctx)) return { error: 'signings are closed in the playoffs' };
  // After the deadline, until the champion is crowned, only a team short at his position may sign
  // (the game tracks no playoff eligibility, so this closes the door the NHL closes with it).
  if (!state.championTeamId && state.date.day > ruleset.season.calendar.tradeDeadlineDay) {
    const at = Object.values(state.players).filter(
      (p) => p.teamId === teamId && p.position === player.position,
    ).length;
    if (at >= (ruleset.roster.positionMin[player.position] ?? 0)) {
      return { error: 'signings are closed after the trade deadline' };
    }
  }
  const salary = Math.round(offer.salary);
  if (!Number.isInteger(offer.years)) return { error: 'illegal term' };
  // NaN would slip past every comparison below.
  if (!Number.isFinite(salary)) return { error: 'illegal salary' };
  const season = capYearOf(state);
  const issues = validateContract(ruleset, {
    salaries: Array<number>(Math.max(0, offer.years)).fill(salary),
    signingAge: season - player.birthYear,
    isResign: false,
    ...(offer.bonusPct !== undefined && { bonusPct: offer.bonusPct }),
    ...(offer.noTrade && {
      noTrade: {
        held: Object.values(state.players).filter((p) => p.teamId === teamId && p.contract?.noTrade)
          .length,
      },
    }),
  });
  if (issues.length) return { error: `illegal contract: ${issues[0]!.code}` };
  const total = teamCapTotal(state, teamId) + salary - capFreed;
  if (capYearIssues(ruleset, state, total).length) return { error: 'no cap room' };
  if (!sheetCompensation(state, ruleset, player, teamId, salary).owned) {
    return { error: 'not enough draft picks for an offer sheet' };
  }
  const view = signingInterest(state, ctx, player, teamId, {
    salary,
    years: offer.years,
    ...(offer.noTrade && { noTrade: true as const }),
    ...(offer.bonusPct && { bonusPct: offer.bonusPct }),
  });
  if (view.interest < lineOf(ctx, player.id)) return { error: NOT_INTERESTED };
  return {
    contract: {
      capHit: salary,
      expiresAfterSeason: season + offer.years - 1,
      ...(offer.noTrade && { noTrade: true as const }),
      ...(offer.bonusPct && { bonus: Math.round((salary * offer.bonusPct) / 100) }),
    },
  };
}
