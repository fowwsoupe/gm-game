import type { Contract, Player, SigningInterest, TeamId, TeamStatus } from '@gm/shared';
import { phaseOf, type LeagueState } from '../core';
import { capYearIssues, capYearOf, teamCapTotal, validateContract, type Ruleset } from '../cba';
import { nextDraftSeason, pickId, pickOwner } from '../league';
import { overall } from '../players';
import { hometownOf, personalityOf } from '../people';
import type { SimContext } from '../context';

/**
 * Free agency v1: a free agent weighs an offer on money, winning, his role and the term, with
 * weights that shift with age (young players chase money and ice time, veterans a winner).
 * Greed and ambition (people engine) tilt those weights. He signs when his interest reaches the
 * threshold.
 */

/** He signs at this interest or above. */
const THRESHOLD = 70;

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

/** Years he would like (more years is never worse for him). */
const wantedYears = (age: number) => (age < 28 ? 5 : age < 32 ? 3 : 2);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** How `player` feels about joining `teamId` for `salary` a year over `years`. */
export function signingInterest(
  state: LeagueState,
  ctx: SimContext,
  player: Player,
  teamId: TeamId,
  offer: { salary: number; years: number; noTrade?: true; bonusPct?: number },
): SigningInterest {
  const { ruleset } = ctx;
  const age = capYearOf(state) - player.birthYear;
  const ask = ctx.models.contractDemand.ask(ruleset, player);
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
      1.5,
    ),
    winning: WINNING[state.teamStatus[teamId] ?? 'bubble'],
    role: clamp(1 - better / depth, 0.2, 1),
    // A no-trade clause is job security: worth about a quarter of the term he wants.
    term: clamp(offer.years / wantedYears(age) + (offer.noTrade ? 0.25 : 0), 0, 1),
  };
  // Playing for his old team or his hometown is worth something on top: a full-score factor that
  // takes its weight from the others, so the same money goes further there (a "discount").
  const pulls: { key: 'loyalty' | 'home'; weight: number }[] = [];
  if (state.formerTeams[player.id] === teamId) {
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
  const keys = ['money', 'winning', 'role', 'term'] as const;
  const interest = keys.reduce((sum, k) => sum + scores[k] * weights[k], 0) + pull; // pulls score 1
  const sheet = sheetCompensation(state, ruleset, player, teamId, Math.round(offer.salary));
  return {
    ...(sheet.picks.length && { sheet }),
    playerId: player.id,
    ask,
    maxYears: ruleset.contracts.maxYearsNewTeam,
    interest: Math.round(clamp(interest, 0, 1) * 100),
    threshold: THRESHOLD,
    factors: [
      ...keys.map((key) => ({
        key,
        score: Math.round(clamp(scores[key], 0, 1) * 100),
        weight: weights[key],
      })),
      ...pulls.map((x) => ({ key: x.key, score: 100, weight: x.weight })),
    ],
  };
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
 * agent, CBA terms, cap) first, then he has to want it.
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
  const inPlayoffs = phaseOf(ruleset.season.calendar, state.date) === 'playoffs';
  if (inPlayoffs && !state.championTeamId) return { error: 'signings are closed in the playoffs' };
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
  if (view.interest < view.threshold) return { error: 'he is not interested' };
  return {
    contract: {
      capHit: salary,
      expiresAfterSeason: season + offer.years - 1,
      ...(offer.noTrade && { noTrade: true as const }),
      ...(offer.bonusPct && { bonus: Math.round((salary * offer.bonusPct) / 100) }),
    },
  };
}
