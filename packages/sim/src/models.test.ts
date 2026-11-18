import { describe, expect, it } from 'vitest';
import {
  createLeague,
  defaultContext,
  handleCommand,
  parseXgTable,
  resignOffers,
  RFA_DISCOUNT,
  rulesGoalModel,
  simGame,
  teamStrength,
  Rng,
  xgTableFromModel,
} from './index';
import type { GameId, TeamId } from '@gm/shared';

describe('table shot model', () => {
  const template = xgTableFromModel(rulesGoalModel);

  it('a table exported from the rules model gives the same chances within a cell', () => {
    const parsed = parseXgTable(JSON.parse(JSON.stringify(template)));
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    for (const [x, y] of [
      [12, 3],
      [30, -10],
      [55, 20],
    ] as const) {
      const shot = { x, y, shooting: 65, power: false };
      const a = rulesGoalModel.shotXg(shot);
      const b = parsed.model.shotXg(shot);
      expect(Math.abs(a - b)).toBeLessThan(a * 0.35);
    }
    // Shooter skill and the power play scale it the same way as the rules model.
    const base = parsed.model.shotXg({ x: 20, y: 5, shooting: 65, power: false });
    expect(parsed.model.shotXg({ x: 20, y: 5, shooting: 85, power: false })).toBeGreaterThan(base);
    expect(parsed.model.shotXg({ x: 20, y: 5, shooting: 65, power: true })).toBeCloseTo(base * 1.5);
    // Beyond the table it uses the last cell instead of failing.
    expect(parsed.model.shotXg({ x: 500, y: -400, shooting: 65, power: false })).toBeGreaterThan(0);
  });

  it('plays a league as a drop-in model: same scoring within noise', () => {
    const parsed = parseXgTable(template);
    if (!parsed.ok) throw new Error('template must parse');
    const state = createLeague(11, defaultContext());
    const [a, b] = Object.keys(state.teams) as TeamId[];
    const strength = (id: TeamId) =>
      teamStrength(Object.values(state.players).filter((p) => p.teamId === id));
    const home = strength(a!);
    const away = strength(b!);
    const goals = (model?: typeof rulesGoalModel) => {
      const rng = new Rng(4);
      let n = 0;
      for (let i = 0; i < 800; i++) {
        const r = simGame(
          {
            id: 'g' as GameId,
            homeTeamId: a!,
            awayTeamId: b!,
            home,
            away,
            resultOnly: true,
          },
          rng,
          model,
        );
        n += r.homeScore + r.awayScore;
      }
      return n / 800;
    };
    expect(Math.abs(goals(parsed.model) - goals())).toBeLessThan(0.4);
  });

  it('is built into the context, and bad files come back as readable errors', () => {
    const parsed = parseXgTable(template);
    if (!parsed.ok) throw new Error('template must parse');
    expect(defaultContext(undefined, { goalModel: parsed.model }).sport.id).toBe('nhl');
    // The context's games use the model it was given: every shot a sure thing scores far more.
    const state = createLeague(11, defaultContext());
    const [a, b] = Object.keys(state.teams) as TeamId[];
    const strength = (id: TeamId) =>
      teamStrength(Object.values(state.players).filter((p) => p.teamId === id));
    const game = {
      id: 'g' as GameId,
      homeTeamId: a!,
      awayTeamId: b!,
      home: strength(a!),
      away: strength(b!),
      resultOnly: true,
    };
    const goals = (ctx: ReturnType<typeof defaultContext>) => {
      const r = ctx.sport.simGame(game, new Rng(4));
      return r.homeScore + r.awayScore;
    };
    expect(goals(defaultContext(undefined, { goalModel: { shotXg: () => 1 } }))).toBeGreaterThan(
      goals(defaultContext()) + 10,
    );
    const bad = parseXgTable({ ...template, goal: [[0.1, 2], [0.1]], powerPlay: 0, version: 2 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join('\n')).toMatch(/version/);
      expect(bad.errors.join('\n')).toMatch(/goal/);
      expect(bad.errors.join('\n')).toMatch(/powerPlay/);
    }
    expect(parseXgTable('nope').ok).toBe(false);
    expect(parseXgTable(null).ok).toBe(false);
  });
});

describe('contract demand model', () => {
  it('a replacement model sets the asking price for re-signing (less the RFA discount)', () => {
    const ctx = defaultContext(undefined, { models: { contractDemand: { ask: () => 2_500_000 } } });
    const state = createLeague(7, ctx);
    const local = { id: 'local', controls: [] };
    handleCommand(state, { kind: 'sim.advance', days: 260 }, local, ctx);
    const team = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const offers = resignOffers(state, ctx, team);
    expect(offers.length).toBeGreaterThan(0);
    const season = state.date.season + 1;
    for (const o of offers) {
      const restricted =
        season - state.players[o.playerId]!.birthYear < ctx.ruleset.contracts.ufaAge;
      expect(o.ask).toBe(restricted ? 2_500_000 * RFA_DISCOUNT : 2_500_000);
    }
  });
});

describe('re-injury risk', () => {
  it('is 1 for a healthy skater, more after injuries, and capped', async () => {
    const { injuryRisk } = await import('./sports/hockey/game');
    const base = createLeague(1, defaultContext());
    const p = Object.values(base.players)[0]!;
    delete p.injuredUntil;
    delete p.injuryHistory;
    expect(injuryRisk(p)).toBe(1);
    p.injuredUntil = 10;
    p.injuryHistory = { count: 1, days: 10 };
    expect(injuryRisk(p)).toBeCloseTo(1.33);
    p.injuryHistory = { count: 100, days: 1000 };
    expect(injuryRisk(p)).toBe(2);
  });
});
