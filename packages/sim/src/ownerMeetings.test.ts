import { describe, expect, it } from 'vitest';
import type { Actor, Command, LeagueEvent, OwnerCard, TeamId } from '@gm/shared';
import {
  coachOf,
  coachSeasonsLeft,
  createLeague,
  defaultContext,
  fansOf,
  handleCommand,
  ownerOf,
  ownerStanding,
  seatsOf,
  ticketPctOf,
  type LeagueState,
} from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };
const cal = ctx.ruleset.season.calendar;

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

/** Everything a card can change, for one team. */
const snapshot = (state: LeagueState, teamId: TeamId) => ({
  cash: state.cash[teamId] ?? 0,
  interest: fansOf(state, teamId).interest,
  ticketPct: ticketPctOf(state.teams[teamId]!, state.ticketPrices),
  confidence: ownerStanding(state, ctx, teamId).confidence,
  payrollBudget: ownerStanding(state, ctx, teamId).payrollBudget,
});

/** A league whose human team has a profit-first owner and cheap tickets, so he asks for them back. */
function humanLeague(fits: (state: LeagueState, teamId: TeamId) => boolean = () => true) {
  const state = createLeague(5, ctx);
  for (const t of Object.values(state.teams)) {
    if (t.userControlled)
      run(state, { kind: 'team.setUserControlled', teamId: t.id, userControlled: false });
  }
  const team = Object.values(state.teams).find(
    (t) => ownerOf(t).priority < 1 / 3 && fits(state, t.id),
  )!;
  run(state, { kind: 'team.setUserControlled', teamId: team.id, userControlled: true });
  run(state, { kind: 'finance.setTicketPrice', teamId: team.id, pct: -20 });
  return { state, teamId: team.id };
}

describe('owner meetings', () => {
  it('sets and grades objectives every season, for every team, three seasons running', () => {
    const state = createLeague(4, ctx);
    const teams = Object.keys(state.teams).length;
    const firings = { inSeason: 0, review: 0 };
    for (let year = 0; year < 3; year++) {
      const events = run(state, {
        kind: 'sim.advance',
        days: cal.regularSeasonDays + cal.playoffDays,
      });
      const meetings = (m: string) =>
        events.flatMap((e) => (e.kind === 'owner.meeting' && e.meeting === m ? [e] : []));
      const set = meetings('preseason');
      const graded = meetings('review');
      expect(set).toHaveLength(teams);
      expect(meetings('deadline')).toHaveLength(teams);
      expect(graded).toHaveLength(teams);
      for (const e of set) {
        expect(e.owner.season).toBe(state.date.season);
        expect(e.owner.objectives.length).toBeGreaterThan(0);
        expect(e.owner.objectives.every((o) => o.met === undefined)).toBe(true);
      }
      for (const e of graded) {
        expect(e.owner.objectives.length).toBeGreaterThan(0);
        expect(e.owner.objectives.every((o) => typeof o.met === 'boolean')).toBe(true);
      }
      // Seasons differ, so the owners grade on something real: not every objective goes one way.
      const met = graded.flatMap((e) => e.owner.objectives.map((o) => o.met));
      expect(new Set(met).size).toBe(2);
      for (const e of events) {
        if (e.kind === 'owner.cardAnswered' && e.effects.coach) {
          firings[e.date.day < cal.regularSeasonDays ? 'inSeason' : 'review']++;
        }
      }
      run(state, { kind: 'season.rollover' });
    }
    // AI owners move on from coaches both mid-season and at the review.
    expect(firings.inSeason).toBeGreaterThan(0);
    expect(firings.review).toBeGreaterThan(0);
  });

  it('every team has a head coach; an old save derives the same one every time', () => {
    const state = createLeague(4, ctx);
    const terms = ctx.ruleset.finance.coach;
    for (const team of Object.values(state.teams)) {
      expect(team.coach!.salary).toBe(terms.salary);
      expect(team.coach!.hired).toBeLessThanOrEqual(state.date.season);
      const old = structuredClone(team);
      delete old.coach;
      expect(coachOf(old, terms, 2030)).toEqual(coachOf(old, terms, 2030));
      expect(coachSeasonsLeft(coachOf(old, terms, 2030), 2030)).toBe(
        coachSeasonsLeft(coachOf(old, terms, 2031), 2031),
      );
    }
  });

  it("firing the coach pays out his deal's remaining years in cash, and a new coach is paid from then on", () => {
    const { state, teamId } = humanLeague();
    run(state, { kind: 'sim.advance', days: 1 });
    // Results far below what the owner expected: he wants the coach gone once 20 games are in.
    state.owners[teamId]!.coachHeat = 0.5;
    let card: OwnerCard | undefined;
    while (!card) {
      run(state, { kind: 'sim.advance', days: 7 });
      card = state.ownerCards.find((c) => c.kind === 'fireCoach');
    }
    const team = state.teams[teamId]!;
    const old = team.coach!;
    const season = state.date.season;
    const gp = Object.values(state.results).filter(
      (g) => g.homeTeamId === teamId || g.awayTeamId === teamId,
    ).length;
    const games = ctx.ruleset.season.gamesPerTeam;
    const left = coachSeasonsLeft(old, season) - 1 + (games - gp) / games;
    expect(card.params.amount).toBe(Math.round(old.salary * left));
    const cash = state.cash[teamId] ?? 0;
    run(state, { kind: 'owner.answerCard', cardId: card.id, option: 'agree' });
    expect(state.cash[teamId]).toBe(cash - card.params.amount!);
    expect(team.coach!.name).not.toBe(old.name);
    expect(team.coach!.hired).toBe(season);
    // His heat starts clean, and he is not put on the seat again this season.
    expect(Math.abs(state.owners[teamId]!.coachHeat!)).toBeLessThan(0.5);
    const rest = run(state, { kind: 'sim.advance', days: cal.regularSeasonDays });
    expect(
      rest.some(
        (e) =>
          e.kind === 'owner.cardOpened' &&
          e.card.kind === 'fireCoach' &&
          e.date.day < cal.regularSeasonDays,
      ),
    ).toBe(false);
    // Staff are paid in the regular season's settlements (a playoff gate settlement pays none).
    const staff = rest.flatMap((e) =>
      e.kind === 'finance.settled' &&
      e.teamId === teamId &&
      e.homeDates > 0 &&
      e.date.day < cal.regularSeasonDays
        ? [e.costs.staff]
        : [],
    );
    expect(staff.every((s) => s! > 0 && s! < team.coach!.salary)).toBe(true);
  });

  it('each card option changes exactly what it says', () => {
    const { state, teamId } = humanLeague();
    const seen = new Set<OwnerCard['kind']>();
    for (let day = 0; day < cal.regularSeasonDays + cal.playoffDays; day += 7) {
      run(state, { kind: 'sim.advance', days: 7 });
      for (const card of state.ownerCards) {
        expect(card.teamId).toBe(teamId);
        seen.add(card.kind);
        for (const option of card.options) {
          const copy = structuredClone(state);
          const before = snapshot(copy, teamId);
          run(copy, { kind: 'owner.answerCard', cardId: card.id, option: option.key });
          const fx = option.effects;
          expect(snapshot(copy, teamId)).toEqual({
            cash: before.cash + (fx.cash ?? 0),
            interest: before.interest + (fx.fanInterest ?? 0),
            ticketPct: fx.ticketPct ?? before.ticketPct,
            confidence: before.confidence + (fx.confidence ?? 0),
            payrollBudget: before.payrollBudget + (fx.payrollBudget ?? 0),
          });
          expect(copy.ownerCards.some((c) => c.id === card.id)).toBe(false);
        }
        run(state, { kind: 'owner.answerCard', cardId: card.id, option: card.options[0]!.key });
      }
    }
    expect(seen.has('ticketPrice')).toBe(true);
    expect(seen.has('budget')).toBe(true);
  });

  it('AI owners answer without a card', () => {
    const { state, teamId } = humanLeague();
    const events: LeagueEvent[] = run(state, {
      kind: 'sim.advance',
      days: cal.regularSeasonDays + cal.playoffDays,
    });
    const opened = new Set(
      events.flatMap((e) => (e.kind === 'owner.cardOpened' ? [e.card.id] : [])),
    );
    const answered = events.flatMap((e) => (e.kind === 'owner.cardAnswered' ? [e] : []));
    const ai = answered.filter((e) => e.teamId !== teamId);
    expect(ai.length).toBeGreaterThan(0);
    expect(ai.every((e) => !opened.has(e.cardId))).toBe(true);
    expect(events.every((e) => e.kind !== 'owner.cardOpened' || e.card.teamId === teamId)).toBe(
      true,
    );
  });

  it('refuses an unknown card or option, and another team', () => {
    const { state, teamId } = humanLeague();
    run(state, { kind: 'sim.advance', days: 1 });
    const card = state.ownerCards.find((c) => c.teamId === teamId)!;
    const answer = (cardId: string, option: string, actor: Actor) =>
      handleCommand(state, { kind: 'owner.answerCard', cardId, option }, actor, ctx).ok;
    expect(answer('nope', 'agree', local)).toBe(false);
    expect(answer(card.id, 'maybe', local)).toBe(false);
    expect(answer(card.id, 'agree', { id: 'remote', controls: [] })).toBe(false);
    expect(answer(card.id, 'agree', local)).toBe(true);
  });

  it('a renovation raises capacity after its build seasons, and is paid for while it is built', () => {
    // Cheap tickets sell the building out, so the owner proposes a renovation at the review.
    const { min, max } = ctx.ruleset.finance.capacity;
    const { state, teamId } = humanLeague((s, id) => seatsOf(s, id, ctx.ruleset) < (min + max) / 2);
    const seats = seatsOf(state, teamId, ctx.ruleset);
    const season = cal.regularSeasonDays + cal.playoffDays;
    run(state, { kind: 'sim.advance', days: season });
    const card = state.ownerCards.find((c) => c.kind === 'renovation')!;
    const project = card.options[0]!.effects.project!;
    run(state, { kind: 'owner.answerCard', cardId: card.id, option: 'agree' });
    for (let year = 0; year < project.seasons; year++) {
      run(state, { kind: 'season.rollover' });
      const events = run(state, { kind: 'sim.advance', days: season });
      expect(seatsOf(state, teamId, ctx.ruleset)).toBe(seats);
      const paid = events.reduce(
        (s, e) => s + (e.kind === 'finance.settled' && e.teamId === teamId ? e.costs.projects : 0),
        0,
      );
      expect(paid).toBe(project.costPerSeason);
    }
    run(state, { kind: 'season.rollover' });
    run(state, { kind: 'sim.advance', days: 1 });
    expect(seatsOf(state, teamId, ctx.ruleset)).toBe(Math.min(max, seats + project.seats));
    expect(state.projects).toHaveLength(state.projects.filter((p) => p.teamId !== teamId).length);
  });
});
