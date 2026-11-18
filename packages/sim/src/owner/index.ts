/**
 * Owner engine (shared by all sports): the three meetings a season, the owner's confidence in
 * his GM, and the cards he puts to a human GM.
 * Owns: preseason objectives and payroll budget, the deadline check-in, the season-end review,
 * a month's nudge to confidence, every card (AI GMs answer theirs at once, with no card), the
 * head coach's seat, and a human GM's: warned below `HOT_SEAT.warn`, fired at a review.
 * Owner behaviour numbers are game feel, not league rules: named constants here, unsourced.
 */
import type { CardEffects, OwnerCard, OwnerObjective, OwnerStanding, TeamId } from '@gm/shared';
import type { Emit, LeagueState, Rng } from '../core';
import { pct, teamName, type Dollars } from '../core';
import { teamCapTotal } from '../cba';
import {
  coachOf,
  coachSeasonsLeft,
  gmOf,
  marketOf,
  newCoach,
  ownerOf,
  randomGm,
  ticketPctOf,
} from '../people';
import { fansOf, seatsOf } from '../finance';
import { leagueStandings } from '../league';
import type { SimContext } from '../context';

/** Confidence a new owner-GM pairing starts at. */
const START_CONFIDENCE = 60;
/** Confidence never drops below this in a new GM's honeymoon (one to three seasons by patience). */
const HONEYMOON_FLOOR = 40;
/**
 * A human GM's job: the owner warns him below `warn` (once a season), and fires him at a
 * season-end review below `fire`, once warned and past the honeymoon. Never mid-season.
 */
const HOT_SEAT = { warn: 30, fire: 15 };
/**
 * An AI GM is fired in the summer when his owner's confidence is below this. Higher than a
 * human's line, and with no honeymoon rule beyond the floor (40): AI GMs go along with every
 * card, which keeps confidence up. Tuned in the lab to the old bottom-quarter rule's turnover
 * (AI GM tenure about 4.2 seasons): less turnover steadies rosters, and goalie save % starts to
 * repeat more than the real league's.
 */
const AI_FIRED_BELOW = 52;
/** A month: confidence per point of points % above (or below) expectation. */
const MONTHLY_RESULTS = 20;
/** The review: confidence for each objective met, and lost for each missed. */
const OBJECTIVE_MET = 8;
const OBJECTIVE_MISSED = 10;
/** The review: confidence lost for a season over the payroll budget, and for losing money. */
const OVER_BUDGET = 5;
const LOST_MONEY = 5;
/** The review: confidence per point of fan interest above (or below) 50. */
const FAN_MOOD = 0.2;
/** How much of last season's points % above .500 the owner expects again. */
const EXPECT_REPEAT = 0.5;
/** A profit owner's target at market 1 (scales with market). */
const PROFIT_TARGET: Dollars = 35_000_000;
/** Payroll budget steps (buy at the deadline, ask for more), as % of the cap. */
const BUDGET_STEP_PCT = 5;
/** Days before the trade deadline that the owner checks in. */
const DEADLINE_NOTICE = 14;
/** A renovation: two seasons of building at a quarter of the cap each, then seats and fans. */
const RENOVATION = { seasons: 2, costPct: 25, seats: 1_000, fanInterest: 3 };
/** The owner proposes a renovation once last month's crowd filled this share of the seats (all of them). */
const SELLOUT = 1;
/** A fan festival (this % of the cap, cash now), proposed when interest is below `below`. */
const FESTIVAL = { costPct: 4, fanInterest: 8, below: 45 };
/** Arena naming rights, sold when cash is below zero: this % of the cap now, fans sour. */
const NAMING_RIGHTS = { cashPct: 20, fanInterest: -5 };

/**
 * The head coach's seat. Heat is points % below expectation since he was hired, in points % x
 * seasons (a .550 team expected that finishes .450 adds 0.1). Tuned in the balance lab to The
 * Win Column's and ESPN's rates (docs/research/2026-11-owner-finance.md).
 */
const COACH = {
  /** Fewest games before an owner judges his coach in-season. */
  minGames: 20,
  /** In-season: a weekly chance of firing, per point of heat above `heat`. */
  heat: 0,
  weekly: 1.2,
  /**
   * At the review: a chance per point of heat above `reviewHeat`. Below zero, because the sim's
   * seasons vary less than real ones: a coach only just beating expectation is not safe either.
   */
  reviewHeat: -0.02,
  review: 18,
  /** Share of a season's heat carried into the next. */
  carry: 0.5,
  /** Confidence firing him lifts; keeping him costs `kept` plus `keptPerHeat` per point of heat. */
  fired: 4,
  kept: 3,
  keptPerHeat: 40,
};

const clamp = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Seasons a new GM's honeymoon lasts: one for the least patient owner, three for the most. */
const honeymoon = (patience: number) => 1 + Math.round(2 * patience);

/** A drop in confidence, made bigger by an impatient owner (x0.5 to x1.5). */
const drop = (amount: number, patience: number) => amount * (1.5 - patience);

/** Confidence after a change: losses scaled by patience, never under the honeymoon floor. */
function moved(standing: OwnerStanding, delta: number, patience: number, season: number) {
  const next = standing.confidence + (delta < 0 ? drop(delta, patience) : delta);
  const floor = season < standing.since + honeymoon(patience) ? HONEYMOON_FLOOR : 0;
  return clamp(Math.max(floor, next));
}

/** Whether an AI GM's owner has lost confidence in him (asked in the summer, after the review). */
export const aiGmFired = (state: LeagueState, teamId: TeamId): boolean =>
  (state.owners[teamId]?.confidence ?? START_CONFIDENCE) < AI_FIRED_BELOW;

/** The owner's baseline payroll budget: from the floor toward the cap by his budget trait. */
function baseBudget(ctx: SimContext, budget: number): Dollars {
  const { lowerLimit, upperLimit } = ctx.ruleset.cap;
  return Math.round((lowerLimit + budget * (upperLimit - lowerLimit)) / 100_000) * 100_000;
}

/** A team's owner standing (a new league, or an old save: a fresh one). */
export function ownerStanding(state: LeagueState, ctx: SimContext, teamId: TeamId): OwnerStanding {
  return (
    state.owners[teamId] ?? {
      confidence: START_CONFIDENCE,
      since: state.date.season,
      season: 0,
      objectives: [],
      expected: 0.5,
      payrollBudget: baseBudget(ctx, ownerOf(state.teams[teamId]!).budget),
      cashAtStart: state.cash[teamId] ?? 0,
    }
  );
}

/** Each team's points % this regular season. */
function pointsPct(state: LeagueState, ctx: SimContext): Map<TeamId, number> {
  const win = ctx.ruleset.season.points.win;
  return new Map(
    leagueStandings(state, ctx.ruleset).map((r) => [r.teamId, r.gp ? r.pts / (win * r.gp) : 0.5]),
  );
}

/** Opens a card for a human GM; an AI GM answers it at once with `aiOption`, and no card is shown. */
function offer(
  state: LeagueState,
  emit: Emit,
  card: Omit<OwnerCard, 'id'>,
  aiOption: OwnerCard['options'][number]['key'],
) {
  const id = `card-${state.date.season}-${state.date.day}-${card.kind}-${card.teamId}`;
  if (state.teams[card.teamId]!.userControlled) {
    emit('major', [card.teamId], { kind: 'owner.cardOpened', card: { ...card, id } });
  } else {
    answer(emit, { ...card, id }, aiOption);
  }
}

function answer(emit: Emit, card: OwnerCard, option: OwnerCard['options'][number]['key']) {
  const effects: CardEffects = card.options.find((o) => o.key === option)!.effects;
  emit('minor', [card.teamId], {
    kind: 'owner.cardAnswered',
    teamId: card.teamId,
    cardId: card.id,
    cardKind: card.kind,
    option,
    effects,
  });
}

/** Cards still open when the next meeting comes are answered for the GM: refused, else agreed. */
function closeOpen(state: LeagueState, emit: Emit, teamId: TeamId) {
  for (const card of state.ownerCards.filter((c) => c.teamId === teamId)) {
    answer(
      emit,
      card,
      card.options.some((o) => o.key === 'refuse') ? 'refuse' : card.options[0]!.key,
    );
  }
}

/** The owner warns a human GM his job is on the line: once a season, while "can be fired" is on. */
function warnIfHot(state: LeagueState, emit: Emit, teamId: TeamId, confidence: number) {
  const standing = state.owners[teamId];
  if (!state.canBeFired || !state.teams[teamId]!.userControlled) return;
  if (confidence >= HOT_SEAT.warn || standing?.warned === state.date.season) return;
  offer(
    state,
    emit,
    {
      teamId,
      kind: 'hotSeat',
      params: { n: Math.round(confidence), fire: HOT_SEAT.fire },
      options: [{ key: 'noted', effects: {} }],
    },
    'noted',
  );
}

/**
 * The preseason meeting (day 0, before the month settles): the owner sets what he expects
 * (last season's points %, halfway back to .500, nudged by the plan), one results objective
 * a rebuild can meet, a profit objective if he cares about money, and keeps the budget the
 * review set. A profit owner whose GM priced tickets below his policy asks for it back.
 */
export function preseasonMeeting(state: LeagueState, ctx: SimContext, emit: Emit): void {
  const season = state.date.season;
  for (const teamId of (Object.keys(state.teams) as TeamId[]).sort()) {
    const team = state.teams[teamId]!;
    const owner = ownerOf(team);
    closeOpen(state, emit, teamId);
    for (const p of state.projects.filter((x) => x.teamId === teamId && x.ready <= season)) {
      const seats = seatsOf(state, teamId, ctx.ruleset) + p.seats;
      emit(team.userControlled ? 'notable' : 'minor', [teamId], {
        kind: 'project.finished',
        teamId,
        projectId: p.id,
        capacity: Math.min(ctx.ruleset.finance.capacity.max, seats),
        fanInterest: p.fanInterest,
      });
    }
    const prev = ownerStanding(state, ctx, teamId);
    const plan = team.plan?.kind;
    const expected = round2(
      0.5 +
        EXPECT_REPEAT * ((prev.lastPct ?? 0.5) - 0.5) +
        (plan === 'contend' ? 0.03 : plan === 'rebuild' ? -0.03 : 0),
    );
    const objectives: OwnerObjective[] = [
      plan === 'rebuild' || expected < 0.47
        ? { kind: 'pointsPct', target: round2(expected - 0.03) }
        : expected >= 0.55 && owner.priority >= 0.5
          ? { kind: 'series', target: 1 }
          : { kind: 'playoffs', target: 1 },
    ];
    if (owner.priority < 0.5) {
      objectives.push({ kind: 'profit', target: Math.round(PROFIT_TARGET * marketOf(team)) });
    }
    emit(team.userControlled ? 'notable' : 'minor', [teamId], {
      kind: 'owner.meeting',
      teamId,
      meeting: 'preseason',
      owner: { ...prev, season, objectives, expected, cashAtStart: state.cash[teamId] ?? 0 },
    });
    if ((state.cash[teamId] ?? 0) < 0) {
      const amount = pct(ctx.ruleset.cap.upperLimit, NAMING_RIGHTS.cashPct);
      offer(
        state,
        emit,
        {
          teamId,
          kind: 'namingRights',
          params: { amount },
          options: [
            { key: 'agree', effects: { cash: amount, fanInterest: NAMING_RIGHTS.fanInterest } },
            { key: 'refuse', effects: { confidence: -2 } },
          ],
        },
        'agree',
      );
    }
    const wanted = ticketPctOf(team, {});
    if (owner.priority < 1 / 3 && ticketPctOf(team, state.ticketPrices) < wanted) {
      offer(
        state,
        emit,
        {
          teamId,
          kind: 'ticketPrice',
          params: { pct: wanted },
          options: [
            { key: 'agree', effects: { ticketPct: wanted, confidence: 3 } },
            { key: 'refuse', effects: { confidence: -3 } },
          ],
        },
        'agree',
      );
    }
  }
}

/**
 * At the review, an owner with no project under way proposes one: a renovation when a smaller-
 * than-average building sold out last month, else a fan festival when interest sags. AI GMs go along.
 */
function proposeProject(state: LeagueState, ctx: SimContext, emit: Emit, teamId: TeamId) {
  if (state.projects.some((p) => p.teamId === teamId)) return;
  const seats = seatsOf(state, teamId, ctx.ruleset);
  const fans = fansOf(state, teamId);
  const cap = ctx.ruleset.cap.upperLimit;
  const refuse = { key: 'refuse' as const, effects: { confidence: -2 } };
  const { min, max } = ctx.ruleset.finance.capacity;
  // Only a smaller arena grows: a big one that sells out raises prices instead.
  if (fans.attendance >= SELLOUT * seats && seats < (min + max) / 2) {
    const costPerSeason = pct(cap, RENOVATION.costPct);
    const project = {
      kind: 'renovation' as const,
      seasons: RENOVATION.seasons,
      costPerSeason,
      seats: RENOVATION.seats,
      fanInterest: RENOVATION.fanInterest,
    };
    offer(
      state,
      emit,
      {
        teamId,
        kind: 'renovation',
        params: { amount: costPerSeason, n: RENOVATION.seasons, seats: RENOVATION.seats },
        options: [{ key: 'agree', effects: { project } }, refuse],
      },
      'agree',
    );
  } else if (fans.interest < FESTIVAL.below) {
    const amount = pct(cap, FESTIVAL.costPct);
    offer(
      state,
      emit,
      {
        teamId,
        kind: 'festival',
        params: { amount },
        options: [
          { key: 'agree', effects: { cash: -amount, fanInterest: FESTIVAL.fanInterest } },
          refuse,
        ],
      },
      'agree',
    );
  }
}

/** Whether the owner checks in today: a fixed number of days before the trade deadline. */
export const checksInOn = (day: number, ctx: SimContext) =>
  day === ctx.ruleset.season.calendar.tradeDeadlineDay - DEADLINE_NOTICE;

/**
 * The deadline check-in: an owner of a bubble team pushes his GM to buy (winning first; he adds
 * to the payroll budget) or to sell (profit first). AI GMs go along.
 */
export function deadlineCheckIn(state: LeagueState, ctx: SimContext, emit: Emit): void {
  const step = pct(ctx.ruleset.cap.upperLimit, BUDGET_STEP_PCT);
  for (const teamId of (Object.keys(state.teams) as TeamId[]).sort()) {
    const team = state.teams[teamId]!;
    emit('minor', [teamId], {
      kind: 'owner.meeting',
      teamId,
      meeting: 'deadline',
      owner: ownerStanding(state, ctx, teamId),
    });
    const status = state.teamStatus[teamId];
    const winFirst = ownerOf(team).priority >= 0.5;
    const standing = ownerStanding(state, ctx, teamId);
    const room = ctx.ruleset.cap.upperLimit - standing.payrollBudget;
    if ((status === 'contender' || status === 'buyer') && winFirst && room > 0) {
      offer(
        state,
        emit,
        {
          teamId,
          kind: 'spendToCap',
          params: { amount: ctx.ruleset.cap.upperLimit },
          options: [
            { key: 'agree', effects: { confidence: 2, payrollBudget: room } },
            { key: 'refuse', effects: { confidence: -2 } },
          ],
        },
        'agree',
      );
      continue;
    }
    const losing = (state.cash[teamId] ?? 0) < standing.cashAtStart;
    if ((status === 'seller' || status === 'rebuilder' || status === 'crisis') && losing) {
      offer(
        state,
        emit,
        {
          teamId,
          kind: 'fireSale',
          params: {},
          options: [
            { key: 'agree', effects: { confidence: 3 } },
            { key: 'refuse', effects: { confidence: -4 } },
          ],
        },
        'agree',
      );
      continue;
    }
    if (status !== 'bubble') continue;
    const buy = winFirst;
    offer(
      state,
      emit,
      {
        teamId,
        kind: buy ? 'deadlineBuy' : 'deadlineSell',
        params: buy ? { amount: step } : {},
        options: [
          {
            key: 'agree',
            effects: buy ? { confidence: 3, payrollBudget: step } : { confidence: 3 },
          },
          { key: 'refuse', effects: { confidence: -4 } },
        ],
      },
      'agree',
    );
  }
}

/**
 * The owner wants the coach gone: a card for a human GM (fire him: pay the rest of his deal, a
 * new coach starts with `heat`; or keep him, at a cost in confidence that grows with the heat),
 * and an AI GM fires him at once.
 */
function coachOnTheSeat(
  state: LeagueState,
  ctx: SimContext,
  emit: Emit,
  rng: Rng,
  args: { teamId: TeamId; heat: number; payout: Dollars; hired: number; startHeat: number },
) {
  const team = state.teams[args.teamId]!;
  const hire = newCoach(rng.fork('hire'), args.hired, ctx.ruleset.finance.coach);
  const gone = coachOf(team, ctx.ruleset.finance.coach, state.date.season).name;
  offer(
    state,
    emit,
    {
      teamId: args.teamId,
      kind: 'fireCoach',
      params: { amount: args.payout },
      options: [
        {
          key: 'agree',
          effects: {
            cash: -args.payout,
            confidence: COACH.fired,
            coach: { hire, heat: args.startHeat },
          },
        },
        {
          key: 'refuse',
          effects: { confidence: -Math.round(COACH.kept + COACH.keptPerHeat * args.heat) },
        },
      ],
    },
    'agree',
  );
  if (team.userControlled) return;
  emit('notable', [args.teamId], {
    kind: 'news.posted',
    headline: 'event.coachFired',
    params: { team: teamName(team), coach: gone, next: hire.name },
  });
}

/** Whether a human GM already has the coach card this season (asked once, or still open). */
const askedAlready = (state: LeagueState, teamId: TeamId, standing: OwnerStanding) =>
  state.teams[teamId]!.userControlled &&
  (standing.coachAsked === state.date.season ||
    state.ownerCards.some((c) => c.teamId === teamId && c.kind === 'fireCoach'));

/**
 * Each week of the regular season, from `COACH.minGames` games: an owner whose coach's heat
 * (carried, plus this season's games so far) runs high may move on him, sooner if impatient.
 * He is paid what is left of this season and of his deal; the new coach answers only for the
 * games from here.
 */
export function coachWeek(state: LeagueState, ctx: SimContext, rng: Rng, emit: Emit): void {
  const season = state.date.season;
  const games = ctx.ruleset.season.gamesPerTeam;
  const win = ctx.ruleset.season.points.win;
  const rows = leagueStandings(state, ctx.ruleset).sort((a, b) => a.teamId.localeCompare(b.teamId));
  for (const row of rows) {
    const standing = state.owners[row.teamId];
    if (row.gp < COACH.minGames || !standing || standing.season !== season) continue;
    if (askedAlready(state, row.teamId, standing)) continue;
    const team = state.teams[row.teamId]!;
    const sofar = ((standing.expected - row.pts / (win * row.gp)) * row.gp) / games;
    const heat = (standing.coachHeat ?? 0) + sofar;
    const chance = COACH.weekly * (heat - COACH.heat) * (1.5 - ownerOf(team).patience);
    const r = rng.fork(row.teamId);
    if (chance <= 0 || !r.chance(chance)) continue;
    const coach = coachOf(team, ctx.ruleset.finance.coach, season);
    const left = coachSeasonsLeft(coach, season) - 1 + (games - row.gp) / games;
    coachOnTheSeat(state, ctx, emit, r, {
      teamId: row.teamId,
      heat,
      payout: Math.round(coach.salary * left),
      hired: season,
      startHeat: round3(-sofar),
    });
  }
}

/** A month of results against what the owner expected nudges his confidence. */
export function ownerMonth(state: LeagueState, ctx: SimContext, emit: Emit): void {
  const points = pointsPct(state, ctx);
  for (const teamId of (Object.keys(state.teams) as TeamId[]).sort()) {
    const standing = state.owners[teamId];
    if (!standing || standing.season !== state.date.season) continue;
    const patience = ownerOf(state.teams[teamId]!).patience;
    const delta = MONTHLY_RESULTS * ((points.get(teamId) ?? 0.5) - standing.expected);
    const confidence = moved(standing, delta, patience, state.date.season);
    const was = standing.confidence;
    if (Math.round(confidence) !== Math.round(was)) {
      emit('minor', [teamId], { kind: 'owner.confidenceMoved', teamId, confidence });
    }
    warnIfHot(state, emit, teamId, confidence);
    // An AI owner losing faith makes the league's news as he crosses the line he fires a GM below.
    const team = state.teams[teamId]!;
    if (!team.userControlled && was >= AI_FIRED_BELOW && confidence < AI_FIRED_BELOW) {
      emit('minor', [teamId], {
        kind: 'news.posted',
        headline: 'event.ownerFrustrated',
        params: { team: teamName(team) },
      });
    }
  }
}

/**
 * The season-end review, once the champion is known (call while the cap year is still this
 * season): each objective is graded, confidence moves with them, with money and fans, and the
 * owner sets next season's payroll budget (a card: a GM may ask for more, at a cost).
 */
export function seasonReview(state: LeagueState, ctx: SimContext, emit: Emit, rng: Rng): void {
  const season = state.date.season;
  const points = pointsPct(state, ctx);
  const series = Object.values(state.playoffSeries);
  const step = pct(ctx.ruleset.cap.upperLimit, BUDGET_STEP_PCT);
  for (const teamId of (Object.keys(state.teams) as TeamId[]).sort()) {
    const team = state.teams[teamId]!;
    const owner = ownerOf(team);
    const prev = ownerStanding(state, ctx, teamId);
    const lastPct = round2(points.get(teamId) ?? 0.5);
    const profit = (state.cash[teamId] ?? 0) - prev.cashAtStart;
    const made = series.some((s) => s.higherTeamId === teamId || s.lowerTeamId === teamId);
    const won = series.filter((s) => s.winnerTeamId === teamId).length;
    const objectives = prev.objectives.map((o) => ({
      ...o,
      met:
        o.kind === 'playoffs'
          ? made
          : o.kind === 'series'
            ? won >= o.target
            : o.kind === 'pointsPct'
              ? lastPct >= o.target
              : profit >= o.target,
    }));
    let delta = 0;
    for (const o of objectives)
      delta += o.met ? OBJECTIVE_MET : -drop(OBJECTIVE_MISSED, owner.patience);
    if (teamCapTotal(state, teamId) > prev.payrollBudget)
      delta -= drop(OVER_BUDGET, owner.patience);
    if (profit < 0) delta -= drop(LOST_MONEY, owner.patience);
    delta += FAN_MOOD * (fansOf(state, teamId).interest - 50);
    // Patience is already in the drops above, so the floor is the only rule left to apply.
    const floor = season < prev.since + honeymoon(owner.patience) ? HONEYMOON_FLOOR : 0;
    const confidence = clamp(Math.max(floor, prev.confidence + delta));
    const payrollBudget = baseBudget(ctx, owner.budget);
    const heat = (prev.coachHeat ?? 0) + prev.expected - lastPct;
    emit(team.userControlled ? 'major' : 'minor', [teamId], {
      kind: 'owner.meeting',
      teamId,
      meeting: 'review',
      owner: {
        ...prev,
        objectives,
        confidence,
        lastPct,
        payrollBudget,
        coachHeat: round3(COACH.carry * heat),
      },
    });
    // A human GM who was warned and has not turned it round is fired; the rest is his successor's.
    const fired =
      state.canBeFired &&
      team.userControlled &&
      confidence < HOT_SEAT.fire &&
      prev.warned !== undefined &&
      season >= prev.since + honeymoon(owner.patience);
    if (fired) {
      emit('major', [teamId], {
        kind: 'career.fired',
        teamId,
        gm: randomGm(rng.fork(`gm${teamId}`)),
      });
      emit('notable', [teamId], {
        kind: 'news.posted',
        headline: 'event.gmFired',
        params: { team: teamName(team) },
      });
      continue;
    }
    warnIfHot(state, emit, teamId, confidence);
    // The coach decision: a new one starts next season with a clean slate.
    const r = rng.fork(teamId);
    const chance = COACH.review * (heat - COACH.reviewHeat) * (1.5 - owner.patience);
    if (
      chance > 0 &&
      r.chance(chance) &&
      !askedAlready(state, teamId, { ...prev, coachAsked: 0 })
    ) {
      const coach = coachOf(team, ctx.ruleset.finance.coach, season);
      coachOnTheSeat(state, ctx, emit, r, {
        teamId,
        heat,
        payout: coach.salary * (coachSeasonsLeft(coach, season) - 1),
        hired: season + 1,
        startHeat: 0,
      });
    }
    offer(
      state,
      emit,
      {
        teamId,
        kind: 'budget',
        params: { amount: payrollBudget, more: step },
        options: [
          { key: 'agree', effects: { confidence: 2 } },
          { key: 'more', effects: { payrollBudget: step, confidence: -5 } },
        ],
      },
      gmOf(team).style === 'winNow' ? 'more' : 'agree',
    );
    proposeProject(state, ctx, emit, teamId);
  }
}
