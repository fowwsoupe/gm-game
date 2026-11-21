import { describe, expect, it } from 'vitest';
import type { Actor, HockeyBoxScore, TeamId } from '@gm/shared';
import { createLeague, dashboard, defaultContext, handleCommand, watchGame } from './index';

/**
 * Watching tonight's game (`watchGame`, behind `GmApi.league.watch`): the watched game is the
 * game the next `sim.advance` plays, and watching leaves the league untouched. One league,
 * played in order through its season: the tests below follow one another.
 */
const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };
const state = createLeague(61, ctx);
const teams = Object.keys(state.teams) as TeamId[];
const sim = (days: number) => handleCommand(state, { kind: 'sim.advance', days }, local, ctx);
const to = (day: number) => {
  if (day > state.date.day) sim(day - state.date.day);
  expect(state.date.day).toBe(day);
};
const lastNight = Math.max(...state.schedule.map((g) => g.date.day));
const round = () => Math.max(0, ...Object.values(state.playoffSeries).map((s) => s.round));
/** A watched game as the league keeps it once played: without the timeline. */
const kept = (game: NonNullable<ReturnType<typeof watchGame>>) => {
  const { timeline, ...box } = game.box as HockeyBoxScore;
  expect(timeline).toBeDefined();
  return { ...game, box };
};

/**
 * Watches every team's game of the league's day, then plays the day. Watching changed nothing,
 * each watched game is the one the day played, a team with no game is shown none, and Home's
 * next game is the watched one. Returns the day's games.
 */
function watchThenPlay() {
  const before = structuredClone(state);
  const watched = teams.map((id) => watchGame(state, ctx, id));
  expect(state).toEqual(before);
  sim(1);
  const today = Object.values(state.results).filter((g) => !before.results[g.id]);
  teams.forEach((id, i) => {
    const game = watched[i];
    const next = dashboard(before, ctx, id).nextGame;
    const offered = next?.day === before.date.day ? next : null;
    if (!game) {
      expect(today.some((g) => g.homeTeamId === id || g.awayTeamId === id)).toBe(false);
      expect(offered).toBeNull();
      return;
    }
    expect(state.results[game.id]).toEqual(kept(game));
    expect(offered).toEqual({
      opponentId: game.homeTeamId === id ? game.awayTeamId : game.homeTeamId,
      home: game.homeTeamId === id,
      day: before.date.day,
    });
  });
  return today;
}

describe("watching tonight's game", () => {
  it('shows nobody a game in camp', () => {
    expect(state.date.day).toBeLessThan(0);
    expect(watchThenPlay()).toEqual([]);
  });

  it('shows a regular-season game as the day plays it: opening night, a second night, a pulse day', () => {
    for (const day of [0, 1, 97]) {
      to(day);
      expect(watchThenPlay().length).toBeGreaterThan(0);
    }
  });

  it('is the first day of a longer sim too, whatever it stops on', () => {
    to(120);
    const league = structuredClone(state);
    const game = teams.map((id) => watchGame(league, ctx, id)).find((g) => g)!;
    handleCommand(league, { kind: 'sim.advance', days: 7, stopOn: 'major' }, local, ctx);
    expect(league.results[game.id]).toEqual(kept(game));
  });

  it('costs less than a day of sim late in the season (budget 250 ms)', () => {
    to(lastNight);
    // The fastest of four: a budget for the code, not for the machine's worst moment.
    const times = teams.slice(0, 4).map((id) => {
      const t0 = performance.now();
      watchGame(state, ctx, id);
      return performance.now() - t0;
    });
    expect(Math.min(...times)).toBeLessThan(250);
    expect(watchThenPlay().length).toBeGreaterThan(0);
  });

  it('shows a playoff game as the day plays it, at home as the series has it', () => {
    to(ctx.ruleset.season.calendar.regularSeasonDays);
    // The first three nights: the lower seed is at home for the third.
    for (let night = 0; night < 3; night++) {
      const games = watchThenPlay();
      expect(games.length).toBeGreaterThan(0);
      expect(games.every((g) => g.playoffSeriesId)).toBe(true);
    }
    while (round() < 2) sim(1);
    expect(watchThenPlay().length).toBeGreaterThan(0);
    // The champion is crowned: nothing left to watch.
    while (!state.championTeamId) sim(1);
    expect(watchThenPlay()).toEqual([]);
  }, 60_000); // the rest of the season and a whole playoffs: 5 s here, CI is about 3.5x slower
});
