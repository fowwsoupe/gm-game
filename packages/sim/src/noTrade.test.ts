import { describe, expect, it } from 'vitest';
import {
  createLeague,
  defaultContext,
  evaluateTrade,
  handleCommand,
  validateContract,
} from './index';

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

  it('a player waives or refuses by who he is, and then the trade is legal', () => {
    const local = { id: 'local', controls: [] };
    const base = createLeague(5, ctx);
    const teams = Object.values(base.teams);
    const mine = teams.find((t) => t.userControlled)!.id;
    const partners = teams.filter((t) => !t.userControlled).slice(0, 4);
    const roster = Object.values(base.players).filter((p) => p.teamId === mine && p.contract);
    let agreed = 0;
    let refused = 0;
    for (const { id } of roster) {
      for (const partner of partners) {
        const state = structuredClone(base);
        state.players[id]!.contract!.noTrade = true;
        const proposal = { fromTeamId: mine, toTeamId: partner.id, give: [id], get: [] };
        expect(evaluateTrade(state, ctx, proposal).accepted).toBe(false);
        const res = handleCommand(
          state,
          { kind: 'contract.askWaiveNoTrade', proposal },
          local,
          ctx,
        );
        if (!res.ok) continue; // the other team does not want him anyway
        const p = state.players[id]!;
        if (res.events.some((e) => e.kind === 'trade.completed')) {
          agreed++;
          expect(p.teamId).toBe(partner.id);
          expect(p.contract!.noTrade).toBeUndefined();
        } else {
          refused++;
          expect(p.teamId).toBe(mine);
          expect(p.contract!.noTrade).toBe(true);
        }
        break;
      }
    }
    expect(agreed).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });
});
