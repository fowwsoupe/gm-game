import { describe, expect, it } from 'vitest';
import type { Actor } from '@gm/shared';
import { createLeague, defaultContext, handleCommand } from '@gm/sim';
import { openSave } from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

describe('SaveFile', () => {
  it('saves a new league and loads the identical state back', () => {
    const save = openSave(':memory:');
    const state = createLeague(4, ctx);
    save.saveNewLeague(state);
    expect(save.loadState()).toEqual(state);
    save.close();
  });

  it('persists events so a reopened save matches the live state', () => {
    const save = openSave(':memory:');
    const state = createLeague(8, ctx);
    save.saveNewLeague(state);
    const res = handleCommand(state, { kind: 'sim.advance', days: 20 }, local, ctx);
    if (!res.ok) throw new Error(res.error.message);
    save.persist(res.events, state);
    expect(save.loadState()).toEqual(state);
    save.close();
  });

  it('resumes a playoff series and saves the champion', () => {
    const save = openSave(':memory:');
    const state = createLeague(17, ctx);
    save.saveNewLeague(state);
    for (const days of [ctx.ruleset.season.calendar.regularSeasonDays + 2, 30]) {
      const res = handleCommand(state, { kind: 'sim.advance', days }, local, ctx);
      if (!res.ok) throw new Error(res.error.message);
      save.persist(res.events, state);
      expect(save.loadState()).toEqual(state);
    }
    expect(state.championTeamId).not.toBeNull();
    const resumed = save.loadState();
    const direct = handleCommand(state, { kind: 'sim.advance', days: 5 }, local, ctx);
    const afterLoad = handleCommand(resumed, { kind: 'sim.advance', days: 5 }, local, ctx);
    expect(afterLoad).toEqual(direct);
    expect(resumed).toEqual(state);
    save.close();
  });

  it('saves a full offseason and loads the identical league, then plays on the same way', () => {
    const save = openSave(':memory:');
    const state = createLeague(21, ctx);
    save.saveNewLeague(state);
    const { regularSeasonDays, playoffDays } = ctx.ruleset.season.calendar;
    for (const command of [
      { kind: 'sim.advance', days: regularSeasonDays + playoffDays },
      { kind: 'season.rollover' },
      { kind: 'sim.advance', days: regularSeasonDays + playoffDays },
      { kind: 'season.rollover' },
    ] as const) {
      const res = handleCommand(state, command, local, ctx);
      if (!res.ok) throw new Error(res.error.message);
      save.persist(res.events, state);
      expect(save.loadState()).toEqual(state);
    }
    expect(state.date.season).toBe(2029);
    const awards = save.listAwards();
    expect(awards.filter((a) => a.season === 2027).map((a) => a.award)).toEqual([
      'champion',
      'mvp',
      'topGoalie',
      'topDefender',
      'topRookie',
    ]);
    expect(awards[0]!.season).toBe(2028);
    expect(awards.find((a) => a.award === 'mvp')!.playerName).toMatch(/\S+ \S+/);
    const resumed = save.loadState();
    const direct = handleCommand(state, { kind: 'sim.advance', days: 30 }, local, ctx);
    const afterLoad = handleCommand(resumed, { kind: 'sim.advance', days: 30 }, local, ctx);
    expect(afterLoad).toEqual(direct);
    save.close();
  });

  it('filters the event log by importance', () => {
    const save = openSave(':memory:');
    const state = createLeague(8, ctx);
    save.saveNewLeague(state);
    const res = handleCommand(state, { kind: 'sim.advance', days: 30 }, local, ctx);
    if (!res.ok) throw new Error();
    save.persist(res.events, state);
    expect(save.listEvents(1000).length).toBeGreaterThan(0);
    for (const e of save.listEvents(1000, 'notable')) expect(e.importance).not.toBe('minor');
    save.close();
  });
});
