import { describe, expect, it } from 'vitest';
import type { LeagueEvent, Player, Team, TeamId } from '@gm/shared';
import { createLeague, defaultContext, emitter, Rng, type LeagueState } from './index';
import { developPlayers } from './offseason';
import { overall } from './players';

const ctx = defaultContext();
const head = (quality: number) => ({ name: 'A B', quality, hired: 2026, salary: 1 });

/** Overall after one summer's development, by player, with `a` and `b` running development. */
function developed(base: LeagueState, a: number, b: number, ids: [TeamId, TeamId]) {
  const state = structuredClone(base);
  const [ta, tb] = ids.map((id) => state.teams[id]!) as [Team, Team];
  ta.staff = { development: head(a) };
  tb.staff = { development: head(b) };
  developPlayers(state, ctx, new Rng(7), emitter(state, [] as LeagueEvent[]), state.date.season);
  return new Map(Object.values(state.players).map((p) => [p.id, overall(p)]));
}

describe('development staff', () => {
  it("an elite department's young players gain more than a poor one's, every team alike", () => {
    const base = createLeague(1, ctx);
    const [a, b] = Object.keys(base.teams).sort() as [TeamId, TeamId];
    base.teams[a]!.userControlled = true; // human teams get their staff's effect too
    const eliteA = developed(base, 1, 0, [a, b]);
    const eliteB = developed(base, 0, 1, [a, b]);
    const young = (team: TeamId) =>
      Object.values(base.players).filter(
        (p: Player) => p.teamId === team && base.date.season - p.birthYear <= 24,
      );
    const gain = (team: TeamId) => {
      const ps = young(team);
      return ps.reduce((s, p) => s + eliteA.get(p.id)! - eliteB.get(p.id)!, 0) / ps.length;
    };
    // Elite (+2 at most) against poor (-2 at most): about 4 points a year apart.
    expect(gain(a)).toBeGreaterThan(3);
    expect(gain(b)).toBeLessThan(-3);
  });
});
