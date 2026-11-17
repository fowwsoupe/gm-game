import { describe, expect, it } from 'vitest';
import type { Actor, Command } from '@gm/shared';
import {
  buyoutCharges,
  createLeague,
  defaultContext,
  handleCommand,
  signingInterest,
  validateContract,
  type LeagueState,
} from './index';

const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();
const { ruleset } = ctx;

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

describe('signing bonuses', () => {
  const salaries = [ruleset.cap.minSalary * 4, ruleset.cap.minSalary * 4];
  const terms = { salaries, signingAge: 30, isResign: false };

  it('are capped at a share of the cap hit', () => {
    const max = ruleset.contracts.maxBonusPct;
    expect(validateContract(ruleset, { ...terms, bonusPct: max })).toEqual([]);
    expect(validateContract(ruleset, { ...terms, bonusPct: max + 1 }).map((i) => i.code)).toEqual([
      'bonus_too_high',
    ]);
    expect(validateContract(ruleset, { ...terms, bonusPct: -5 }).map((i) => i.code)).toEqual([
      'bonus_too_high',
    ]);
  });

  it('are never bought out: the buyout is on the salary part only', () => {
    const state = createLeague(5, ctx);
    const p = Object.values(state.players).find((x) => x.teamId && x.contract)!;
    p.contract = { capHit: 4_000_000, expiresAfterSeason: state.date.season + 3 };
    const plain = buyoutCharges(ruleset, {
      teamId: p.teamId!,
      player: p,
      season: state.date.season,
    });
    p.contract = { ...p.contract, bonus: 2_000_000 };
    const withBonus = buyoutCharges(ruleset, {
      teamId: p.teamId!,
      player: p,
      season: state.date.season,
    });
    const sum = (c: { amount: number }[]) => c.reduce((s, x) => s + x.amount, 0);
    expect(sum(withBonus)).toBe(Math.round(sum(plain) / 2));
  });

  it('a free agent signs with the bonus on his contract, and likes it', () => {
    const state = createLeague(5, ctx);
    run(state, { kind: 'sim.advance', days: 300 });
    run(state, { kind: 'offseason.openFreeAgency' });
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const fa = Object.values(state.players).filter((p) => p.teamId === null);
    for (const p of fa) {
      const ask = ctx.models.contractDemand.ask(ruleset, p);
      const offer = { salary: Math.round(ask * 1.1), years: 3 };
      const plain = signingInterest(state, ctx, p, mine, offer);
      const bonus = signingInterest(state, ctx, p, mine, { ...offer, bonusPct: 40 });
      expect(bonus.interest).toBeGreaterThanOrEqual(plain.interest);
    }
    // One of them signs: the bonus is a share of the cap hit, rounded to dollars.
    for (const p of fa) {
      const ask = ctx.models.contractDemand.ask(ruleset, p);
      const res = handleCommand(
        state,
        {
          kind: 'contract.sign',
          playerId: p.id,
          teamId: mine,
          salary: ask * 2,
          years: 2,
          bonusPct: 25,
        },
        local,
        ctx,
      );
      if (!res.ok) continue;
      const ev = res.events[0]!;
      if (ev.kind !== 'player.signed') continue;
      expect(ev.contract.bonus).toBe(Math.round(ev.contract.capHit * 0.25));
      return;
    }
    throw new Error('nobody could be signed');
  });
});
