import { describe, expect, it } from 'vitest';
import { createLeague, defaultContext, evaluateTrade, validateContract } from './index';

const ctx = defaultContext();
const { ruleset } = ctx;
const salaries = [ruleset.cap.minSalary * 2, ruleset.cap.minSalary * 2];

describe('no-trade clauses', () => {
  it('need a player old enough, and a team holds only so many', () => {
    const ok = validateContract(ruleset, {
      salaries,
      signingAge: ruleset.contracts.ufaAge,
      isResign: false,
      noTrade: { held: 0 },
    });
    expect(ok).toEqual([]);
    const young = validateContract(ruleset, {
      salaries,
      signingAge: ruleset.contracts.ufaAge - 1,
      isResign: false,
      noTrade: { held: 0 },
    });
    expect(young.map((i) => i.code)).toEqual(['no_trade_age']);
    const full = validateContract(ruleset, {
      salaries,
      signingAge: 30,
      isResign: false,
      noTrade: { held: ruleset.contracts.maxNoTradePerTeam },
    });
    expect(full.map((i) => i.code)).toEqual(['no_trade_limit']);
  });

  it('a trade with a protected player is refused', () => {
    const state = createLeague(5, ctx);
    const teams = Object.values(state.teams);
    const mine = teams.find((t) => t.userControlled)!.id;
    const partner = teams.find((t) => !t.userControlled)!.id;
    const mineP = Object.values(state.players).find((p) => p.teamId === mine && p.contract)!;
    const theirP = Object.values(state.players).find((p) => p.teamId === partner && p.contract)!;
    const proposal = { fromTeamId: mine, toTeamId: partner, give: [mineP.id], get: [theirP.id] };
    mineP.contract!.noTrade = true;
    const res = evaluateTrade(state, ctx, proposal);
    expect(res.accepted).toBe(false);
    expect(res.reasons[0]!.code).toBe('no_trade');
  });
});
