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
