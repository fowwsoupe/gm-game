import { describe, expect, it } from 'vitest';
import { capSheet, computeStandings, createLeague, defaultContext, handleCommand } from './index';
import type { TeamId } from '@gm/shared';

/**
 * Speed budget. Fails the build if the sim gets slower than the targets in the spec.
 * Budgets are generous for slow CI machines; tighten them as the sim grows.
 * Screen data (standings, leaders, cap sheet) is timed here too: the app screens only render these.
 */
const ctx = defaultContext();
// Default: 4 seasons so `pnpm test` stays fast. `pnpm test:slow` (nightly CI) plays the full 20.
const YEARS = process.env.GM_SLOW ? 20 : 4;

describe('speed budget', () => {
  it('sims a full regular season in under 5 s', () => {
    const state = createLeague(123, ctx);
    const t0 = performance.now();
    const res = handleCommand(
      state,
      { kind: 'sim.advance', days: ctx.ruleset.season.calendar.regularSeasonDays },
      { id: 'local', controls: [] },
      ctx,
    );
    const ms = performance.now() - t0;
    expect(res.ok).toBe(true);
    expect(ms).toBeLessThan(5_000);
  });

  it('rolls a league over to the next season well under 1 s', () => {
    const state = createLeague(5, ctx);
    const local = { id: 'local', controls: [] };
    const { regularSeasonDays, playoffDays } = ctx.ruleset.season.calendar;
    handleCommand(
      state,
      { kind: 'sim.advance', days: regularSeasonDays + playoffDays },
      local,
      ctx,
    );
    const t0 = performance.now();
    const res = handleCommand(state, { kind: 'season.rollover' }, local, ctx);
    expect(res.ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(1_000);
  });

  it('sims one day in under 0.25 s', () => {
    const state = createLeague(7, ctx);
    const t0 = performance.now();
    handleCommand(state, { kind: 'sim.advance', days: 1 }, { id: 'local', controls: [] }, ctx);
    expect(performance.now() - t0).toBeLessThan(250);
  });

  it('still sims a season and rolls over fast in the last year', async () => {
    const state = createLeague(77, ctx);
    const local = { id: 'local', controls: [] };
    const { regularSeasonDays, playoffDays } = ctx.ruleset.season.calendar;
    const year = () => {
      handleCommand(
        state,
        { kind: 'sim.advance', days: regularSeasonDays + playoffDays },
        local,
        ctx,
      );
      return handleCommand(state, { kind: 'season.rollover' }, local, ctx);
    };
    for (let y = 0; y < YEARS - 1; y++) {
      expect(year().ok).toBe(true);
      // Let the test worker answer the runner between seasons (see offseason.test.ts).
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const t0 = performance.now();
    expect(year().ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(6_000);
    expect(Object.keys(state.players).length).toBeLessThan(2_000); // retired players do not pile up

    // Screen data in the last year, with the most history: each must feel instant.
    const teamIds = Object.keys(state.teams) as TeamId[];
    const results = Object.values(state.results);
    const time = (fn: () => unknown) => {
      const t = performance.now();
      fn();
      return performance.now() - t;
    };
    const { ruleset, sport } = ctx;
    expect(time(() => computeStandings(teamIds, results, ruleset.season.points))).toBeLessThan(250);
    expect(time(() => sport.leaders(results, Object.values(state.players), 10))).toBeLessThan(250);
    expect(
      time(() =>
        capSheet(ruleset, {
          teamId: teamIds[0]!,
          players: Object.values(state.players),
          charges: state.capCharges,
          fromSeason: state.date.season,
          years: ruleset.contracts.maxYearsResign,
          phase: 'regular',
        }),
      ),
    ).toBeLessThan(250);
  }, 120_000); // 20 seasons (GM_SLOW) take ~30 s on CI; the time budget is for the last one
});
