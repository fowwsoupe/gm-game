import { describe, expect, it } from 'vitest';
import type { Actor, GameId, PlayerId, TeamId } from '@gm/shared';
import {
  autoLineup,
  chemistry,
  createLeague,
  defaultContext,
  handleCommand,
  Rng,
  teamStrength,
} from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

describe('lines', () => {
  it('your depth order puts a player on the top line and starts your goalie', () => {
    const state = createLeague(71, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const roster = Object.values(state.players).filter((p) => p.teamId === mine);
    const auto = autoLineup(roster);
    const fourthC = auto.forwards[3]![0]!;
    const backup = auto.goalies[1]!;
    const res = handleCommand(
      state,
      { kind: 'lines.set', teamId: mine, order: [fourthC.id, backup.id] },
      local,
      ctx,
    );
    expect(res.ok).toBe(true);
    const mineNow = autoLineup(roster, state.depthCharts[mine]);
    expect(mineNow.forwards[0]![0]!.id).toBe(fourthC.id);
    expect(mineNow.goalies[0]!.id).toBe(backup.id);
    // The game uses it: the backup is in net in your first game.
    const played = handleCommand(state, { kind: 'sim.advance', days: 10 }, local, ctx);
    if (!played.ok) throw new Error(played.error.message);
    const game = played.events.find(
      (e) =>
        e.kind === 'game.final' && (e.result.homeTeamId === mine || e.result.awayTeamId === mine),
    );
    if (game?.kind !== 'game.final') throw new Error('no game');
    const box = game.result.box as {
      home: { goalie: { id: string } };
      away: { goalie: { id: string } };
    };
    const side = game.result.homeTeamId === mine ? box.home : box.away;
    expect(side.goalie.id).toBe(backup.id);
  });

  it('only takes your own players, once each, for your own team', () => {
    const state = createLeague(72, ctx);
    const teams = Object.values(state.teams);
    const mine = teams.find((t) => t.userControlled)!.id;
    const other = teams.find((t) => !t.userControlled)!.id;
    const theirs = Object.values(state.players).find((p) => p.teamId === other)!.id;
    const mineId = Object.values(state.players).find((p) => p.teamId === mine)!.id;
    const set = (teamId: typeof mine, order: PlayerId[]) =>
      handleCommand(state, { kind: 'lines.set', teamId, order }, local, ctx).ok;
    expect(set(mine, [theirs])).toBe(false);
    expect(set(mine, [mineId, mineId])).toBe(false);
    expect(set(other, [theirs])).toBe(false);
    expect(set(mine, [])).toBe(true);
  });
});

describe('power-play and penalty-kill units', () => {
  it('saved units are validated and used in games; unset falls back to auto', () => {
    const state = createLeague(76, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const roster = Object.values(state.players).filter((p) => p.teamId === mine);
    const auto = autoLineup(roster);
    const fourth = auto.forwards[3]!.slice(0, 3).map((p) => p.id);
    const pair = auto.defense[2]!.map((p) => p.id);
    const set = (unit: 'pp1' | 'pk1', playerIds: PlayerId[]) =>
      handleCommand(state, { kind: 'units.set', teamId: mine, unit, playerIds }, local, ctx).ok;
    expect(set('pp1', [...fourth.slice(0, 2), ...pair])).toBe(false); // 2F+2D is not a power play
    expect(set('pp1', [...fourth, fourth[0]!, pair[0]!])).toBe(false); // once each
    expect(set('pp1', [...fourth, ...pair])).toBe(true);
    expect(state.specialUnits[mine]!.pp1).toEqual([...fourth, ...pair]);
    const view = (s = state) =>
      ctx.sport.specialUnits(roster, s.depthCharts[mine], s.specialUnits[mine]);
    expect(view().pp1!.custom).toBe(true);
    expect(view().pp2!.custom).toBe(false);
    // Your fourth-line forwards play the power play; the auto PP1 is the top line.
    const ppToi = (units?: Record<string, PlayerId[]>) => {
      const strength = ctx.sport.teamStrength(roster, [], 0.5, units);
      const other = ctx.sport.teamStrength(roster, [], 0.5);
      const rng = new Rng(5);
      const toi = new Map<string, number>();
      for (let i = 0; i < 40; i++) {
        const g = ctx.sport.simGame(
          {
            id: `u${i}` as GameId,
            homeTeamId: 'a' as TeamId,
            awayTeamId: 'b' as TeamId,
            home: strength,
            away: other,
          },
          rng,
        );
        const box = g.box as { home: { skaters: { id: string; ppToi: number }[] } };
        for (const sk of box.home.skaters) toi.set(sk.id, (toi.get(sk.id) ?? 0) + sk.ppToi);
      }
      return (id: string) => toi.get(id) ?? 0;
    };
    const topWinger = auto.forwards[0]![1]!.id;
    const custom = ppToi(state.specialUnits[mine] as Record<string, PlayerId[]>);
    const plain = ppToi();
    expect(custom(fourth[0]!)).toBeGreaterThan(plain(fourth[0]!));
    expect(custom(topWinger)).toBeLessThan(plain(topWinger));
    expect(set('pp1', [])).toBe(true);
    expect(state.specialUnits[mine]!.pp1).toBeUndefined();
  });
});

describe('chemistry', () => {
  it('grows with time together, drops with new faces, and moves strength a little', () => {
    const state = createLeague(73, ctx);
    const teams = Object.values(state.teams);
    const mine = teams.find((t) => t.userControlled)!.id;
    const roster = () => Object.values(state.players).filter((p) => p.teamId === mine);
    expect(chemistry(roster(), state.date.season).value).toBe(1); // a settled, original roster
    // A new face joins this season: the team's chemistry dips.
    const partner = teams.find((t) => !t.userControlled)!.id;
    const theirs = Object.values(state.players).find((p) => p.teamId === partner)!;
    state.players[theirs.id]!.teamId = mine;
    state.players[theirs.id]!.joined = state.date.season;
    const after = chemistry(roster(), state.date.season);
    expect(after.value).toBeLessThan(1);
    expect(chemistry(roster(), state.date.season + 3).value).toBe(1);
    // Capped effect: a settled team vs a brand-new one differ by 2 rating points at most.
    const settled = teamStrength(roster(), [], 1);
    const fresh = teamStrength(roster(), [], 0);
    expect(settled.offense - fresh.offense).toBeCloseTo(2, 5);
  });

  it('a traded player joins his new team this season', () => {
    const state = createLeague(74, ctx);
    const teams = Object.values(state.teams);
    const mine = teams.find((t) => t.userControlled)!.id;
    const partner = teams.find((t) => !t.userControlled)!.id;
    const generous = defaultContext(ctx.ruleset.id, {
      models: { valuation: { value: () => ({ surplus: 50_000_000, reasons: [] }) } },
    });
    const cheapest = Object.values(state.players)
      .filter((p) => p.teamId === mine && p.position === 'C')
      .sort((a, b) => a.contract!.capHit - b.contract!.capHit)[0]!;
    const res = handleCommand(
      state,
      {
        kind: 'trade.propose',
        proposal: { fromTeamId: mine, toTeamId: partner, give: [cheapest.id], get: [] },
      },
      local,
      generous,
    );
    if (!res.ok) throw new Error(res.error.message);
    expect(state.players[cheapest.id]!.joined).toBe(state.date.season);
  });
});

describe('chemistry in games', () => {
  it('a settled team outscores the same roster thrown together, by a little', () => {
    const state = createLeague(75, ctx);
    const roster = Object.values(state.players).filter(
      (p) => p.teamId === Object.keys(state.teams)[0],
    );
    const settled = teamStrength(roster, [], 1);
    const fresh = teamStrength(roster, [], 0);
    const rng = new Rng(9);
    let diff = 0;
    const games = 6000;
    for (let i = 0; i < games; i++) {
      const home = i % 2 === 0;
      const g = ctx.sport.simGame(
        {
          id: `c${i}` as GameId,
          homeTeamId: 'a' as TeamId,
          awayTeamId: 'b' as TeamId,
          home: home ? settled : fresh,
          away: home ? fresh : settled,
          resultOnly: true,
        },
        rng,
      );
      diff += home ? g.homeScore - g.awayScore : g.awayScore - g.homeScore;
    }
    // Worth something, but capped: a few tenths of a goal a game at most.
    expect(diff / games).toBeGreaterThan(0.02);
    expect(diff / games).toBeLessThan(0.6);
  }, 30_000); // ~1.5 s locally, ~5 s on CI; seeded, so the threshold never flakes
});
