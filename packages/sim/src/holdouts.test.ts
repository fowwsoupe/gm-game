import { describe, expect, it } from 'vitest';
import type { Actor, Command } from '@gm/shared';
import {
  available,
  createLeague,
  defaultContext,
  handleCommand,
  personalityOf,
  talkedRound,
  type LeagueState,
} from './index';

const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

/** A league where every player on my team is badly underpaid, played to the first game. */
function atStart(seed: number) {
  const state = createLeague(seed, ctx);
  const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
  for (const p of Object.values(state.players)) {
    if (p.teamId === mine && p.contract) p.contract.capHit = ctx.ruleset.cap.minSalary;
  }
  const events = run(state, {
    kind: 'sim.advance',
    days: 1,
  });
  return { state, mine, events, ours: () => state.holdouts.filter((h) => h.teamId === mine) };
}

/** The first seed where one of my players holds out (searched once), freshly played each call. */
let holdoutSeed: number | undefined;
function withHoldout() {
  if (holdoutSeed === undefined) {
    for (let seed = 1; seed < 40 && holdoutSeed === undefined; seed++) {
      if (atStart(seed).ours().length > 0) holdoutSeed = seed;
    }
  }
  if (holdoutSeed === undefined) throw new Error('no holdout in 40 seeds');
  return atStart(holdoutSeed);
}

describe('holdouts', () => {
  it('an underpaid, greedy core player may refuse to report, and then sits out', () => {
    const { state, ours } = withHoldout();
    expect(ours()).toHaveLength(1);
    const { playerId } = ours()[0]!;
    expect(personalityOf(playerId).greed).toBeGreaterThanOrEqual(0.6);
    // A talk works exactly when who he is says so; otherwise he gives up within the season.
    run(state, { kind: 'holdout.talk', playerId });
    expect(ours().length === 0).toBe(talkedRound(playerId));
    run(state, { kind: 'sim.advance', days: 100 });
    expect(ours()).toHaveLength(0);
  });

  it('a traded holdout is no longer holding out', () => {
    const { state, mine, ours } = withHoldout();
    const { playerId } = ours()[0]!;
    const partner = Object.values(state.teams).find((t) => t.id !== mine)!.id;
    const generous = defaultContext(ctx.ruleset.id, {
      models: { valuation: { value: () => ({ surplus: 50_000_000, reasons: [] }) } },
    });
    const res = handleCommand(
      state,
      {
        kind: 'trade.propose',
        proposal: { fromTeamId: mine, toTeamId: partner, give: [playerId], get: [] },
      },
      local,
      generous,
    );
    if (!res.ok) throw new Error(res.error.message);
    expect(state.players[playerId]!.teamId).toBe(partner);
    expect(state.holdouts.some((h) => h.playerId === playerId)).toBe(false);
  });

  it('an AI GM pays a holdout in his last season if he plays to win; a builder waits him out', () => {
    const cases = [
      { style: 'winNow', skill: 1, yearsLeft: 0, pays: true },
      { style: 'winNow', skill: 1, yearsLeft: 1, pays: false }, // not his last season yet
      { style: 'balanced', skill: 0.6, yearsLeft: 0, pays: true },
      { style: 'balanced', skill: 0.4, yearsLeft: 0, pays: false },
      { style: 'builder', skill: 1, yearsLeft: 0, pays: false },
      // No room left to fill next season's roster at the minimum once he is paid.
      { style: 'winNow', skill: 1, yearsLeft: 0, pays: false, squeezed: true },
    ] as const;
    for (const c of cases) {
      const { style, skill, yearsLeft, pays } = c;
      const found = (() => {
        for (let seed = 1; seed < 40; seed++) {
          const state = createLeague(seed, ctx);
          const ai = Object.values(state.teams).find((t) => !t.userControlled)!;
          ai.gm = { style, skill };
          for (const p of Object.values(state.players)) {
            if (p.teamId !== ai.id || !p.contract) continue;
            p.contract = {
              capHit: ctx.ruleset.cap.minSalary,
              expiresAfterSeason: state.date.season + yearsLeft,
            };
          }
          run(state, { kind: 'sim.advance', days: 1 });
          const h = state.holdouts.find((x) => x.teamId === ai.id);
          if (h) return { state, playerId: h.playerId };
        }
        throw new Error('no AI holdout in 40 seeds');
      })();
      const { state, playerId } = found;
      if ('squeezed' in c) {
        const teamId = state.players[playerId]!.teamId!;
        const { upperLimit, minSalary } = ctx.ruleset.cap;
        // Dead cap next season: everything but the minimum for a full roster, less one dollar.
        const amount = upperLimit - ctx.ruleset.roster.minActive * minSalary - 1;
        state.capCharges.push({
          teamId,
          playerId: playerId, // any id: the charge only takes cap room
          kind: 'buyout',
          season: state.date.season + 1,
          amount,
        });
      }
      run(state, { kind: 'sim.advance', days: 6 }); // to the first weekly check
      expect(state.players[playerId]!.extension !== undefined).toBe(pays);
      if (pays) expect(state.holdouts.some((h) => h.playerId === playerId)).toBe(false);
    }
  });
});

describe('who plays tonight', () => {
  it('a holdout or a hurt player is out of the lineup the games and the lines screen use', () => {
    const state = createLeague(95, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const [a, b] = Object.values(state.players).filter((p) => p.teamId === mine);
    state.holdouts.push({ playerId: a!.id, teamId: mine });
    state.players[b!.id]!.injuredUntil = state.date.day + 5;
    const ids = available(state, mine, state.date.day).map((p) => p.id);
    expect(ids).not.toContain(a!.id);
    expect(ids).not.toContain(b!.id);
    expect(available(state, mine, state.date.day + 5).map((p) => p.id)).toContain(b!.id);
  });
});
