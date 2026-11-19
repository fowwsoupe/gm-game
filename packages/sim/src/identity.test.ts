import { describe, expect, it } from 'vitest';
import type { Actor, TeamId } from '@gm/shared';
import { createLeague, defaultContext, handleCommand } from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

describe('team.rename', () => {
  it('renames any team for the local player and keeps abbreviations unique', () => {
    const state = createLeague(3, ctx);
    const [a, b] = Object.keys(state.teams) as TeamId[];
    const rename = (teamId: TeamId, abbreviation: string) =>
      handleCommand(
        state,
        { kind: 'team.rename', teamId, city: ' Québec ', name: 'Fleuves', abbreviation },
        local,
        ctx,
      );
    expect(rename(a!, 'qbf').ok).toBe(true);
    expect(state.teams[a!]).toMatchObject({ city: 'Québec', name: 'Fleuves', abbreviation: 'QBF' });
    expect(rename(b!, 'QBF').ok).toBe(false);
    expect(rename(b!, 'Q').ok).toBe(false);
    expect(
      handleCommand(
        state,
        { kind: 'team.rename', teamId: b!, city: '', name: 'x', abbreviation: 'XYZ' },
        local,
        ctx,
      ).ok,
    ).toBe(false);
    expect(rename(b!, 'XYZ').ok).toBe(true);
    const other: Actor = { id: 'p2', controls: [] };
    expect(
      handleCommand(
        state,
        { kind: 'team.rename', teamId: a!, city: 'a', name: 'b', abbreviation: 'AAA' },
        other,
        ctx,
      ).ok,
    ).toBe(false);
  });
});
