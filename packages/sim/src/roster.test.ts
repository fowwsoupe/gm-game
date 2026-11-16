import { describe, expect, it } from 'vitest';
import { GOALIE_RATINGS, isGoalie, SKATER_RATINGS } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  exportHockeyRoster,
  handleCommand,
  importHockeyRoster,
  payroll,
  Rng,
} from './index';

const ctx = defaultContext();
const fictional = () => ctx.sport.generateLeague(new Rng(7).fork('league'), ctx.ruleset);

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

  it('gives every generated player exactly the rating keys of his position', () => {
    for (const p of fictional().players) {
      const keys = isGoalie(p.position) ? GOALIE_RATINGS : SKATER_RATINGS;
      expect(Object.keys(p.ratings).sort()).toEqual([...keys].sort());
    }
  });

  it('upgrades a v1 file: faceoffs start at the average of the other skater ratings', () => {
    const file = JSON.parse(
      JSON.stringify(exportHockeyRoster(fictional(), { season: 2027, name: 'Old' })),
    );
    file.formatVersion = 1;
    for (const p of file.players) if (p.skater) delete p.skater.faceoffs;
    const skater = file.players.find((p: { skater?: object }) => p.skater);
    const others = Object.values(skater.skater as Record<string, number>);
    const res = importHockeyRoster(file);
    if (!res.ok) throw new Error(res.errors.join('\n'));
    const loaded = res.players.find((p) => p.id === `p_${skater.id}`)!;
    expect(loaded.ratings.faceoffs).toBe(
      Math.round(others.reduce((a, b) => a + b, 0) / others.length),
    );
    expect(file.formatVersion).toBe(1); // the caller's object is not changed
  });

  it('generates payrolls legal under the ruleset it is given, not a fixed cap', () => {
    const tight = { ...ctx.ruleset, cap: { ...ctx.ruleset.cap, upperLimit: 60_000_000 } };
    const league = ctx.sport.generateLeague(new Rng(7).fork('league'), tight);
    for (const team of league.teams) {
      const roster = league.players.filter((p) => p.teamId === team.id);
      expect(payroll(roster)).toBeLessThanOrEqual(tight.cap.upperLimit);
    }
  });
});
