import { describe, expect, it } from 'vitest';
import {
  createLeague,
  defaultContext,
  exportHockeyRoster,
  handleCommand,
  importHockeyRoster,
  Rng,
} from './index';

const ctx = defaultContext();
const fictional = () => ctx.sport.generateLeague(new Rng(7).fork('league'));

describe('roster files', () => {
  it('round-trips: export a league, import it back, same players', () => {
    const league = fictional();
    const file = exportHockeyRoster(league, { season: 2027, name: 'Test' });
    const res = importHockeyRoster(JSON.parse(JSON.stringify(file)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.teams).toHaveLength(league.teams.length);
    expect(res.players).toHaveLength(league.players.length);
    expect(res.players[0]!.ratings).toEqual(league.players[0]!.ratings);
    expect(res.teams[0]!.userControlled).toBe(true);
  });

  it('a loaded roster is a playable league', () => {
    const file = exportHockeyRoster(fictional(), { season: 2031, name: 'Test' });
    const res = importHockeyRoster(file);
    if (!res.ok) throw new Error(res.errors.join('\n'));
    const state = createLeague(1, ctx, res);
    expect(state.date.season).toBe(2031);
    const out = handleCommand(
      state,
      { kind: 'sim.advance', days: 10 },
      { id: 'local', controls: [] },
      ctx,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.events.some((e) => e.kind === 'game.final')).toBe(true);
  });

  it('rejects bad files with readable errors', () => {
    expect(importHockeyRoster({ hello: 'world' }).ok).toBe(false);
    const file = exportHockeyRoster(fictional(), { season: 2027, name: 'Test' });
    file.players[0]!.team = 'ZZZ';
    const res = importHockeyRoster(file);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/Unknown team ZZZ/);
  });

  it('rejects a team with no goalie', () => {
    const file = exportHockeyRoster(fictional(), { season: 2027, name: 'Test' });
    const abbr = file.teams[1]!.abbreviation;
    file.players = file.players.filter((p) => !(p.team === abbr && p.position === 'G'));
    const res = importHockeyRoster(file);
    expect(res.ok).toBe(false);
  });
});
