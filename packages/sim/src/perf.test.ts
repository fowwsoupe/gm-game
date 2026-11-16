import { describe, expect, it } from 'vitest';
import { createLeague, defaultContext, handleCommand } from './index';

/**
 * Speed budget. Fails the build if the sim gets slower than the targets in the spec.
 * Budgets are generous for slow CI machines; tighten them as the sim grows.
 * TODO: add a year-20 save once multi-season works, and screen-open timing in the app.
 */
const ctx = defaultContext();

describe('speed budget', () => {
  it('sims a full regular season well under 20 s', () => {
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

  it('sims one day well under 0.5 s', () => {
    const state = createLeague(7, ctx);
    const t0 = performance.now();
    handleCommand(state, { kind: 'sim.advance', days: 1 }, { id: 'local', controls: [] }, ctx);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});
