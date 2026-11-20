import { describe, expect, it } from 'vitest';
import type { Actor, Command, LeagueEvent, TeamId } from '@gm/shared';
import { available, createLeague, defaultContext, handleCommand, type LeagueState } from './index';
import { emitter, phaseOf, Rng } from './core';
import { campBattles, campRead, campReport, releaseCampOrders } from './people';
import { overall } from './players';
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
      (e) => e.kind === 'news.posted' && /^event\.camp\.(sharp|expected|flat)$/.test(e.headline),
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

describe('camp battles', () => {
  /** Camp's last day: a team's last dressed player at a position one point above the best one left out. */
  function battle() {
    const state = summerLeague(1);
    run(state, { kind: 'season.rollover' });
    state.date.day = -1;
    const mins = Object.entries(ctx.ruleset.roster.positionMin).filter(([p]) => p !== 'G');
    const have = (team: TeamId, position: string) =>
      available(state, team, -1).filter((p) => p.position === position).length;
    // A team with every position full and one with a spare.
    const pick = Object.values(state.teams)
      .filter((t) => !t.userControlled && mins.every(([pos, n]) => have(t.id, pos) >= n))
      .flatMap((team) => mins.map(([position, spots]) => ({ team, position, spots })))
      .find(({ team, position, spots }) => have(team.id, position) > spots)!;
    const { team, position, spots } = pick;
    const group = available(state, team.id, -1)
      .filter((p) => p.position === position)
      .sort((a, b) => overall(b) - overall(a));
    // Two veterans, one point apart (`last` the better one), and clear gaps around them.
    group.forEach((p, i) => {
      p.birthYear = state.date.season - 30;
      const level = i < spots - 1 ? 90 : i === spots - 1 ? 61 : i === spots ? 60 : 30;
      for (const k of Object.keys(p.ratings)) p.ratings[k] = level;
    });
    const [last, next] = [group[spots - 1]!, group[spots]!];
    return { state, team, position, last, next };
  }

  it('is found between the last player dressed and the best one left out, within the gap', () => {
    const { state, team, position, last, next } = battle();
    const found = campBattles(state, ctx, team.id).find((b) => b.position === position)!;
    expect([found.group[found.spots - 1], found.group[found.spots]]).toEqual([last, next]);
    next.ratings = Object.fromEntries(Object.keys(next.ratings).map((k) => [k, 40]));
    expect(campBattles(state, ctx, team.id).some((b) => b.position === position)).toBe(false);
  });

  it("an elite coach plays the better player more often than a poor one, and an AI team's pick holds two weeks", () => {
    const trials = 200;
    const { state, team, last } = battle();
    const lines = (quality: number) => {
      team.coach = { ...(team.coach ?? { name: 'C', hired: 2026, salary: 0, years: 1 }), quality };
      let better = 0;
      for (let i = 0; i < trials; i++) {
        state.depthCharts[team.id] = [];
        campReport(state, ctx, new Rng(i), emitter(state, [] as LeagueEvent[]));
        // No order: the better player already dresses. An order: the coach picked the worse one.
        if (!state.depthCharts[team.id]!.length) better++;
        else if (i === 0 || state.depthCharts[team.id]!.indexOf(last.id) > 0) {
          expect(state.depthCharts[team.id]!.indexOf(last.id)).toBeGreaterThan(0);
        }
      }
      return better / trials;
    };
    expect(lines(0.9)).toBeGreaterThan(lines(0.1) + 0.1);
    releaseCampOrders(state, emitter(state, [] as LeagueEvent[]));
    expect(state.depthCharts[team.id]).toEqual([]);
  });
});
