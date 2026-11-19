import { describe, expect, it } from 'vitest';
import type { Actor, TeamId } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, marketOf } from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

describe('team.relocate', () => {
  it('moves a franchise to a new market and cools its fans', () => {
    const state = createLeague(3, ctx);
    const teamId = Object.keys(state.teams)[0] as TeamId;
    const move = (market: number) =>
      handleCommand(
        state,
        {
          kind: 'team.relocate',
          teamId,
          city: 'Houston',
          name: 'Comets',
          abbreviation: 'HOU',
          market,
        },
        local,
        ctx,
      );
    expect(move(3).ok).toBe(false);
    expect(move(1.75).ok).toBe(true);
    expect(state.teams[teamId]).toMatchObject({
      city: 'Houston',
      abbreviation: 'HOU',
      market: 1.75,
    });
    expect(marketOf(state.teams[teamId]!)).toBe(1.75);
    expect(state.fans[teamId]?.interest).toBe(50 - ctx.ruleset.finance.relocationFanLoss);
  });
});

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
