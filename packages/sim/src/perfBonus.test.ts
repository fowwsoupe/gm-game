import { describe, expect, it } from 'vitest';
import type { Actor, TeamId } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, teamCapTotal } from './index';

const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();

describe('performance bonuses', () => {
  it('a skater earns a share per target met; a goalie for games and save %', () => {
    const earned = ctx.sport.bonusEarned;
    expect(earned({ gp: 80, goals: 25, assists: 40, points: 65 }, 82)).toBe(1);
    expect(earned({ gp: 80, goals: 5, assists: 10, points: 15 }, 82)).toBe(0.25);
    expect(earned({ gp: 10, goals: 0, assists: 0, points: 0 }, 82)).toBe(0);
    expect(earned({ gp: 50, savePct: 0.92 }, 82)).toBe(1);
    expect(earned({ gp: 50, savePct: 0.9 }, 82)).toBe(0.5);
    expect(earned({ gp: 5, savePct: 0.95 }, 82)).toBe(0);
  });

  it('are paid when the playoffs end; what goes over the cap counts on next season', () => {
    const state = createLeague(91, ctx);
    const team = Object.keys(state.teams)[0] as TeamId;
    const roster = Object.values(state.players).filter((p) => p.teamId === team);
    for (const p of roster) p.contract = { ...p.contract!, perfBonus: 850_000 };
    // Right up against the cap, so any bonus goes over.
    const room = ctx.ruleset.cap.upperLimit - teamCapTotal(state, team);
    state.capCharges.push({
      teamId: team,
      playerId: roster[0]!.id,
      kind: 'buyout',
      season: state.date.season,
      amount: room,
    });
    const season = state.date.season;
    const res = handleCommand(state, { kind: 'sim.advance', days: 400 }, local, ctx);
    if (!res.ok) throw new Error(res.error.message);
    expect(state.championTeamId).not.toBeNull();
    const paid = res.events.find((e) => e.kind === 'bonuses.paid');
    if (paid?.kind !== 'bonuses.paid') throw new Error('no bonuses paid');
    const mine = paid.paid.filter((x) => x.teamId === team);
    const total = mine.reduce((s, x) => s + x.amount, 0);
    expect(total).toBeGreaterThan(0);
    // Only those who played enough earn anything, never more than the bonus.
    for (const x of mine) expect(x.amount).toBeLessThanOrEqual(850_000);
    const over = state.capCharges.filter((c) => c.kind === 'bonusOverage' && c.teamId === team);
    expect(over.every((c) => c.season === season + 1)).toBe(true);
    expect(over.reduce((s, c) => s + c.amount, 0)).toBe(total);
    // Nobody else had a bonus.
    expect(paid.paid.every((x) => x.teamId === team)).toBe(true);
  }, 60_000);

  it('first-round picks sign entry deals with the most allowed in performance bonuses', () => {
    const state = createLeague(92, ctx);
    const res = handleCommand(state, { kind: 'sim.advance', days: 400 }, local, ctx);
    if (!res.ok) throw new Error(res.error.message);
    const open = handleCommand(state, { kind: 'offseason.openFreeAgency' }, local, ctx);
    if (!open.ok) throw new Error(open.error.message);
    const drafted = open.events.flatMap((e) => (e.kind === 'player.drafted' ? [e] : []));
    expect(drafted.length).toBeGreaterThan(0);
    for (const d of drafted) {
      if (!d.player.contract) continue;
      expect(d.player.contract.perfBonus).toBe(
        d.round === 1 ? ctx.ruleset.contracts.maxPerformanceBonus : undefined,
      );
    }
  }, 60_000);
});
