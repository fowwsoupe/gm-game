import { describe, expect, it } from 'vitest';
import type { Actor, Command, OwnerCard, TeamId } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, type LeagueState } from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };
const cal = ctx.ruleset.season.calendar;
const SEASON = cal.regularSeasonDays + cal.playoffDays;

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

/**
 * A human team in its fifth season under an owner who expects a .900 team: every month
 * disappoints him. `canBeFired` is the save option.
 */
function tanking(canBeFired: boolean) {
  const state = createLeague(6, ctx);
  for (const t of Object.values(state.teams)) {
    if (t.userControlled)
      run(state, { kind: 'team.setUserControlled', teamId: t.id, userControlled: false });
  }
  const teamId = Object.keys(state.teams).sort()[0] as TeamId;
  run(state, { kind: 'team.setUserControlled', teamId, userControlled: true });
  // A team that really loses, whatever the rest of the league does.
  for (const p of Object.values(state.players).filter((x) => x.teamId === teamId)) {
    for (const k of Object.keys(p.ratings)) p.ratings[k] = Math.max(1, p.ratings[k]! - 20);
  }
  if (!canBeFired) run(state, { kind: 'league.setCanBeFired', on: false });
  run(state, { kind: 'sim.advance', days: 1 }); // the preseason meeting
  const owner = state.owners[teamId]!;
  owner.expected = 0.9;
  owner.since = state.date.season - 5;
  owner.confidence = 35;
  return { state, teamId };
}

describe('your job on the line', () => {
  it('a tanking human GM is warned, then fired at the review, and takes a job offered in the summer', () => {
    const { state, teamId } = tanking(true);
    const events = run(state, { kind: 'sim.advance', days: SEASON });
    const warned = events.findIndex(
      (e) => e.kind === 'owner.cardOpened' && e.card.kind === 'hotSeat',
    );
    const fired = events.findIndex((e) => e.kind === 'career.fired');
    expect(warned).toBeGreaterThanOrEqual(0);
    expect(fired).toBeGreaterThan(warned);
    // At the season-end review, never in the middle of the season.
    expect(events[fired]!.date.day).toBeGreaterThanOrEqual(cal.regularSeasonDays);
    expect(state.teams[teamId]!.userControlled).toBe(false);
    expect(state.ownerCards.filter((c) => c.teamId === teamId)).toEqual([]);
    expect(state.career).toMatchObject({ firedFrom: teamId, offers: [] });
    // Picking a team is not the way back in; an offer is.
    const pick = { kind: 'team.setUserControlled', teamId, userControlled: true } as const;
    expect(handleCommand(state, pick, local, ctx).ok).toBe(false);

    run(state, { kind: 'season.rollover' });
    const offers = state.career!.offers;
    expect(offers.length).toBeGreaterThan(0);
    expect(offers).not.toContain(teamId);
    expect(handleCommand(state, { kind: 'career.takeJob', teamId }, local, ctx).ok).toBe(false);
    run(state, { kind: 'career.takeJob', teamId: offers[0]! });
    expect(state.teams[offers[0]!]!.userControlled).toBe(true);
    expect(state.career).toBeNull();
    // A new owner, a fresh start: the next meeting opens his honeymoon.
    run(state, { kind: 'sim.advance', days: 1 });
    expect(state.owners[offers[0]!]).toMatchObject({ since: state.date.season });
  });

  it('with "can be fired" off, the same GM is never warned or fired', () => {
    const { state, teamId } = tanking(false);
    const events = run(state, { kind: 'sim.advance', days: SEASON });
    expect(events.some((e) => e.kind === 'career.fired')).toBe(false);
    expect(events.some((e) => e.kind === 'owner.cardOpened' && e.card.kind === 'hotSeat')).toBe(
      false,
    );
    expect(state.teams[teamId]!.userControlled).toBe(true);
    // He would have been: the owner has given up on him.
    expect(state.owners[teamId]!.confidence).toBeLessThan(15);
  });

  it('AI GMs are fired when their owner loses confidence, not for where they finished', () => {
    const state = createLeague(7, ctx);
    run(state, { kind: 'sim.advance', days: SEASON });
    const ai = (Object.keys(state.teams) as TeamId[])
      .filter((id) => !state.teams[id]!.userControlled)
      .sort();
    const [doubted, trusted] = ai;
    for (const [id, confidence] of [
      [doubted!, 10],
      [trusted!, 90],
    ] as const) {
      state.owners[id] = { ...state.owners[id]!, confidence, since: state.date.season - 5 };
    }
    const events = run(state, { kind: 'season.rollover' });
    const firedAt = events.flatMap((e) =>
      e.kind === 'team.gmChanged' && e.fired ? [e.teamId] : [],
    );
    expect(firedAt).toContain(doubted);
    expect(firedAt).not.toContain(trusted);
    // The new GM starts afresh with the owner.
    expect(state.owners[doubted!]).toBeUndefined();
  });
});

describe('press questions', () => {
  it('a human GM is asked after a streak; his answer moves the owner and makes a headline', () => {
    const { state, teamId } = tanking(true);
    const events = run(state, { kind: 'sim.advance', days: cal.regularSeasonDays });
    const opened = events.find(
      (e) =>
        e.kind === 'owner.cardOpened' && e.card.kind === 'pressLoss' && e.card.teamId === teamId,
    );
    expect(opened).toBeDefined();
    // Later meetings close open cards: answer a fresh copy.
    const card = { ...(opened as { card: OwnerCard }).card, id: 'press-test' };
    state.ownerCards.push(card);
    const before = state.owners[teamId]!.confidence;
    const out = run(state, { kind: 'owner.answerCard', cardId: card.id, option: 'honest' });
    expect(state.owners[teamId]!.confidence).toBe(Math.min(100, before + 2));
    expect(out.some((e) => e.kind === 'news.posted' && e.headline === 'press.quote.honest')).toBe(
      true,
    );
  });
});
