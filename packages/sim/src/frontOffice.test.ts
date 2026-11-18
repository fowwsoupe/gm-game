import { describe, expect, it } from 'vitest';
import type { LeagueEvent, Player, Team, TeamId } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  emitter,
  handleCommand,
  Rng,
  strengthFor,
  type LeagueState,
} from './index';
import { changeStaff, developPlayers, staffCandidates, teamRange } from './offseason';
import { ownerOf } from './people';
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

describe('the staff market', () => {
  it('heads move on and rich owners hire better ones; the new head is stored', () => {
    const state = createLeague(1, ctx);
    const log: LeagueEvent[] = [];
    const emit = emitter(state, log);
    for (let season = 0; season < 30; season++) {
      changeStaff(state, ctx, new Rng(season), emit, 2027 + season);
    }
    const hires = log.flatMap((e) => (e.kind === 'staff.hired' ? [e] : []));
    // About 12% of 48 heads a summer, plus poaching.
    expect(hires.length).toBeGreaterThan(30 * 48 * 0.1);
    expect(hires.length).toBeLessThan(30 * 48 * 0.25);
    const last = hires.at(-1)!;
    expect(state.teams[last.teamId]!.staff?.[last.department]).toEqual(last.head);
    const byBudget = (rich: boolean) => {
      const q = hires
        .filter((h) => ownerOf(state.teams[h.teamId]!).budget > 0.5 === rich)
        .map((h) => h.head.quality);
      return q.reduce((a, b) => a + b, 0) / q.length;
    };
    expect(byBudget(true)).toBeGreaterThan(byBudget(false) + 0.1);
  });
});

describe('scouting and medical staff', () => {
  it("a good scouting department's range is narrower and closer to the truth", () => {
    const state = createLeague(1, ctx);
    const team = Object.values(state.teams)[0]!;
    const good = { ...team, staff: { scouting: head(1) } };
    const poor = { ...team, staff: { scouting: head(0) } };
    const prospects = Array.from({ length: 200 }, (_, i) => ({
      player: { ...Object.values(state.players)[0]!, id: `p${i}` as Player['id'], potential: 70 },
      low: 65,
      high: 75,
    }));
    const err = (t: Team) =>
      prospects.reduce((s, d) => {
        const r = teamRange(t, d, ctx, 2027);
        return s + Math.abs((r.low + r.high) / 2 - 70);
      }, 0) / prospects.length;
    const width = (t: Team) => {
      const r = teamRange(t, prospects[0]!, ctx, 2027);
      return r.high - r.low;
    };
    expect(err(good)).toBeLessThan(err(poor) / 2);
    expect(width(good)).toBeLessThan(width(poor));
  });

  it('the best medical staff shortens injuries, the worst lengthens them', () => {
    // The games are the same until the first injured player comes back, so compare that injury.
    const first = (quality: number) => {
      const state = createLeague(1, ctx);
      for (const t of Object.values(state.teams)) t.staff = { medical: head(0.5) };
      const mine = Object.keys(state.teams).sort()[0] as TeamId;
      state.teams[mine]!.staff = { medical: head(quality) };
      const done = handleCommand(
        state,
        { kind: 'sim.advance', days: 120 },
        { id: 'local', controls: [] },
        ctx,
      );
      if (!done.ok) throw new Error(done.error.message);
      const hurt = done.events.find((e) => e.kind === 'player.injured' && e.teamIds.includes(mine));
      if (hurt?.kind !== 'player.injured') throw new Error('no injury');
      return hurt;
    };
    const [best, worst] = [first(1), first(0)];
    expect(best.playerId).toBe(worst.playerId);
    expect(best.days).toBeLessThan(worst.days);
    // x0.81 against x1.19 (the league average moves a little with this team's staff).
    expect(best.days / worst.days).toBeGreaterThan(0.5);
    expect(best.days / worst.days).toBeLessThan(0.8);
  });
});

describe('the head coach in games', () => {
  it('a great coach adds to the team, a poor one takes away', () => {
    const state = createLeague(1, ctx);
    const teamId = Object.keys(state.teams).sort()[0] as TeamId;
    const players = Object.values(state.players).filter((p) => p.teamId === teamId);
    const strength = (quality: number) => {
      const team = state.teams[teamId]!;
      team.coach = { name: 'A B', hired: 2026, salary: 1, years: 3, quality };
      return strengthFor(state, ctx, teamId, players) as { offense: number; defense: number };
    };
    const [great, poor] = [strength(1), strength(0)];
    const points = 2 * ctx.ruleset.frontOffice.coaching.points;
    expect(great.offense - poor.offense).toBeCloseTo(points);
    expect(great.defense - poor.defense).toBeCloseTo(points);
  });
});

describe('hiring through commands', () => {
  it('hires a candidate, once a department a season, only for your own team', () => {
    const state = createLeague(1, ctx);
    const [mine, theirs] = Object.keys(state.teams).sort() as [TeamId, TeamId];
    const you = { id: 'you', controls: [mine] };
    const hire = (teamId: TeamId, candidate: number) =>
      handleCommand(
        state,
        { kind: 'staff.hire', teamId, department: 'development', candidate },
        you,
        ctx,
      );
    const pick = staffCandidates(state.teams[mine]!, 'development', ctx, state.date.season)[2]!;
    const done = hire(mine, 2);
    expect(done.ok).toBe(true);
    expect(state.teams[mine]!.staff?.development).toEqual(pick);
    expect(hire(mine, 0).ok).toBe(false); // already hired this season
    expect(hire(theirs, 0).ok).toBe(false); // not yours
    // Once the champion is crowned, a hire counts for the season ahead: a new one is allowed.
    state.championTeamId = theirs;
    expect(hire(mine, 1).ok).toBe(true);
    expect(state.teams[mine]!.staff?.development?.hired).toBe(state.date.season + 1);
    expect(hire(mine, 0).ok).toBe(false);
    const [cheap, , dear] = staffCandidates(state.teams[theirs]!, 'medical', ctx, 2030);
    expect(cheap!.quality).toBeLessThanOrEqual(dear!.quality);
  });
});
