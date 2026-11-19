import { describe, expect, it } from 'vitest';
import type { Actor, Command, LeagueEvent } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, type LeagueState } from './index';
import { phaseOf, Rng } from './core';
import { campRead } from './people';
import { summerLeague } from './testLeagues';

const ctx = defaultContext();
const cal = ctx.ruleset.season.calendar;
const local: Actor = { id: 'local', controls: [] };

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

const mineOf = (state: LeagueState) => Object.values(state.teams).find((t) => t.userControlled)!.id;
const meetings = (events: readonly LeagueEvent[]) =>
  events.filter((e) => e.kind === 'owner.meeting' && e.meeting === 'preseason');

describe('camp', () => {
  it('a season opens with three weeks of camp: the owner meets on day one, the coach reports on the last, no games until opening night', () => {
    const state = summerLeague(1);
    const rolled = run(state, { kind: 'season.rollover' });
    expect(state.date.day).toBe(-cal.preseasonDays);
    expect(phaseOf(cal, state.date)).toBe('preseason');
    expect(rolled.at(-1)).toMatchObject({ kind: 'season.phaseChanged', to: 'preseason' });

    const first = run(state, { kind: 'sim.advance', days: 1 });
    expect(meetings(first)).toHaveLength(Object.keys(state.teams).length);
    const camp = run(state, { kind: 'sim.advance', days: cal.preseasonDays - 1 });
    expect(state.date.day).toBe(0);
    expect(first.concat(camp).some((e) => e.kind === 'game.final')).toBe(false);
    expect(meetings(camp)).toEqual([]);
    // One read, for the human team only.
    const reports = camp.filter(
      (e) => e.kind === 'news.posted' && e.headline.startsWith('event.camp.'),
    );
    expect(reports.map((e) => e.teamIds)).toEqual([[mineOf(state)]]);
    expect(reports[0]!.date.day).toBe(-1);

    const opening = run(state, { kind: 'sim.advance', days: 1 });
    expect(opening.some((e) => e.kind === 'game.final')).toBe(true);
    expect(meetings(opening)).toEqual([]);
  });

  it("a new league opens with camp, and an underpaid player's holdout starts on its first day", () => {
    for (let seed = 1; seed < 40; seed++) {
      const state = createLeague(seed, ctx);
      expect(state.date.day).toBe(-cal.preseasonDays);
      const mine = mineOf(state);
      for (const p of Object.values(state.players)) {
        if (p.teamId === mine && p.contract) p.contract.capHit = ctx.ruleset.cap.minSalary;
      }
      const started = run(state, { kind: 'sim.advance', days: 1 }).find(
        (e) => e.kind === 'player.holdoutStarted',
      );
      if (!started) continue;
      expect(started.date.day).toBe(-cal.preseasonDays);
      return;
    }
    throw new Error('no holdout in 40 seeds');
  });

  it("an elite coach's camp read is right more often than a poor one's", () => {
    const sd = ctx.ruleset.season.form;
    const rng = new Rng(7);
    const forms = Array.from({ length: 2000 }, () => rng.normal(0, sd));
    // A perfect coach (no noise) reads the truth.
    const right = (quality: number) =>
      forms.filter(
        (f, i) => campRead(f, quality, sd, new Rng(i)) === campRead(f, 1, sd, new Rng(i)),
      ).length / forms.length;
    expect(right(0.9)).toBeGreaterThan(0.85);
    expect(right(0.9)).toBeGreaterThan(right(0.1) + 0.2);
  });
});
