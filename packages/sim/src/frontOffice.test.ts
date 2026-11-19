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
import {
  changeStaff,
  departmentReturns,
  developPlayers,
  staffCandidates,
  teamRange,
} from './offseason';
import { DEPARTMENTS, departmentsOf, ownerOf } from './people';
import { playerProfiles } from './profiles';
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
    // Elite against poor: about twice `development.points` apart a year for young players.
    const apart = 2 * ctx.ruleset.frontOffice.development.points;
    expect(gain(a)).toBeGreaterThan(apart * 0.75);
    expect(gain(b)).toBeLessThan(-apart * 0.75);
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
    // `leave` of every head a summer (no games played, so no poaching).
    const heads = Object.keys(state.teams).length * DEPARTMENTS.length;
    const expected = 30 * heads * ctx.ruleset.frontOffice.leave;
    expect(hires.length).toBeGreaterThan(expected * 0.8);
    expect(hires.length).toBeLessThan(expected * 1.2);
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

describe('analytics staff', () => {
  it("a poor department sees rivals' players further from the truth; your own are exact", () => {
    const state = createLeague(1, ctx);
    const [mine, theirs] = Object.keys(state.teams).sort() as [TeamId, TeamId];
    for (const t of Object.values(state.teams)) t.userControlled = false; // no human: true ratings
    const [ownTrue, rivalTrue] = [
      playerProfiles(state, ctx, mine),
      playerProfiles(state, ctx, theirs),
    ];
    state.teams[mine]!.userControlled = true;
    const off = (quality: number) => {
      state.teams[mine]!.staff = { analytics: head(quality) };
      expect(playerProfiles(state, ctx, mine)).toMatchObject(ownTrue); // plus your training plans
      const seen = playerProfiles(state, ctx, theirs);
      const gaps = seen.flatMap((p, i) =>
        p.percentiles.map((x, k) => Math.abs(x.value - rivalTrue[i]!.percentiles[k]!.value)),
      );
      return gaps.reduce((a, b) => a + b, 0) / gaps.length;
    };
    const [elite, poor] = [off(1), off(0)];
    expect(elite).toBeGreaterThan(0);
    expect(poor).toBeGreaterThan(elite * 2);
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
    // Measured around the league's average coach, which this team's own quality moves a little.
    const n = Object.keys(state.teams).length;
    const points = (2 * ctx.ruleset.frontOffice.coaching.points * (n - 1)) / n;
    expect(great.offense - poor.offense).toBeCloseTo(points);
    expect(great.defense - poor.defense).toBeCloseTo(points);
    // A league of equal coaches is a league of average ones.
    const equal = (quality: number) => {
      for (const t of Object.values(state.teams)) {
        t.coach = { name: 'A B', hired: 2026, salary: 1, years: 3, quality };
      }
      return (strengthFor(state, ctx, teamId, players) as { offense: number }).offense;
    };
    expect(equal(0.9)).toBeCloseTo(equal(0.1));
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

describe('legends as staff', () => {
  const legend = (position: string, awards: string[]) => ({
    playerId: 'x' as never,
    name: 'Real Legend',
    position,
    retiredSeason: 2030,
    seasons: 15,
    totals: {},
    awards,
  });

  it('offers one legend a team-season, in a fitting department, by his career', () => {
    const state = createLeague(1, ctx);
    const team = state.teams[Object.keys(state.teams).sort()[0] as TeamId]!;
    const season = state.date.season;
    for (const [l, fit] of [
      [legend('G', ['topGoalie', 'topGoalie']), ['medical', 'development']],
      [legend('C', ['mvp', 'mvp', 'mvp']), ['scouting', 'analytics', 'assistant']],
    ] as const) {
      const hits = departmentsOf(team).filter((d) =>
        staffCandidates(team, d, ctx, season, [l]).some((c) => c.legend),
      );
      expect(hits).toHaveLength(1);
      expect(fit).toContain(hits[0]);
      const c = staffCandidates(team, hits[0]!, ctx, season, [l])[2]!;
      expect(c.name).toBe('Real Legend');
      expect(c.quality).toBeCloseTo(0.6 + 0.07 * l.awards.length);
      // Same again; and without legends the list is the plain one.
      expect(staffCandidates(team, hits[0]!, ctx, season, [l])[2]).toEqual(c);
      expect(staffCandidates(team, hits[0]!, ctx, season)[2]!.legend).toBeUndefined();
    }
  });
});

describe('firing a head and department returns', () => {
  it('puts an interim in, pays the rest of his salary, locks the department', () => {
    const state = createLeague(1, ctx);
    const [mine, theirs] = Object.keys(state.teams).sort() as [TeamId, TeamId];
    const you = { id: 'you', controls: [mine] };
    const fire = (teamId: TeamId) =>
      handleCommand(state, { kind: 'staff.fire', teamId, department: 'medical' }, you, ctx);
    state.teams[mine]!.staff = { medical: { ...head(0.9), hired: 2020, salary: 2_000_000 } };
    state.date = { ...state.date, day: ctx.ruleset.season.calendar.regularSeasonDays / 2 };
    const cash = state.cash[mine] ?? 0;
    expect(fire(mine).ok).toBe(true);
    const interim = state.teams[mine]!.staff!.medical!;
    expect(interim.quality).toBe(ctx.ruleset.frontOffice.interim);
    expect(interim.hired).toBe(state.date.season);
    expect(state.cash[mine]).toBe(cash - 1_000_000); // half the season left
    expect(fire(mine).ok).toBe(false); // changed this season
    expect(
      handleCommand(
        state,
        { kind: 'staff.hire', teamId: mine, department: 'medical', candidate: 0 },
        you,
        ctx,
      ).ok,
    ).toBe(false);
    expect(fire(theirs).ok).toBe(false); // not yours
    // A good head returns more than an average one; the interim returns less.
    state.teams[mine]!.staff = { development: head(1), medical: head(1) };
    const r = departmentReturns(state, ctx, mine);
    expect(r.development).toBeGreaterThan(0);
    expect(r.medical).toBeGreaterThan(0);
  });

  it('a poor assistant reads your roster further off than an elite one', () => {
    const state = createLeague(3, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const head = (quality: number) => ({ name: 'A B', quality, hired: 2027, salary: 1 });
    const err = (quality: number) => {
      state.teams[mine]!.staff = { assistant: head(quality) };
      return departmentReturns(state, ctx, mine).assistant!.error;
    };
    expect(err(0)).toBeGreaterThan(err(1));
  });
});
