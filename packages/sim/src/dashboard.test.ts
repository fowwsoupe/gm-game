import { describe, expect, it } from 'vitest';
import type { Actor } from '@gm/shared';
import {
  applyEvent,
  createLeague,
  dashboard,
  defaultContext,
  handleCommand,
  playerName,
} from './index';
import { assistantGuess, cachedContext, delegatedOffers, evaluateTrade } from './trades';
import { overall } from './players';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

describe('home dashboard', () => {
  it('lists what needs a decision and the next game', () => {
    const state = createLeague(51, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const start = dashboard(state, ctx, mine);
    // Camp: 25 signed, two to send down by opening night.
    expect(start.todo).toEqual([{ code: 'rosterOver', params: { count: 2 }, screen: 'roster' }]);
    expect(start.nextGame).not.toBeNull();

    const roster = Object.values(state.players).filter((p) => p.teamId === mine);
    roster[0]!.injuredUntil = ctx.ruleset.season.calendar.tradeDeadlineDay + 10;
    roster.find((p) => p.position === 'G')!.teamId = null;
    state.date = { ...state.date, day: ctx.ruleset.season.calendar.tradeDeadlineDay - 3 };
    const codes = dashboard(state, ctx, mine).todo.map((i) => i.code);
    expect(codes).toEqual(['injured', 'rosterShort', 'deadline']);
  });

  it('asks for re-signings and a draft list once the season is over', () => {
    const state = createLeague(52, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    handleCommand(state, { kind: 'sim.advance', days: 300 }, local, ctx);
    const codes = dashboard(state, ctx, mine).todo.map((i) => i.code);
    expect(codes).toContain('draftList');
    expect(dashboard(state, ctx, mine).nextGame).toBeNull();
    handleCommand(state, { kind: 'offseason.openFreeAgency' }, local, ctx);
    const after = dashboard(state, ctx, mine).todo.map((i) => i.code);
    expect(after).toContain('freeAgency');
    expect(after).not.toContain('resign');
  });
});

describe('the assistant GM', () => {
  it("advises on every offer, and an elite one's advice is right more often than a poor one's", () => {
    const state = createLeague(54, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!;
    const theirs = Object.values(state.teams).find((t) => !t.userControlled)!;
    const roster = (id: string) => Object.values(state.players).filter((p) => p.teamId === id);
    state.tradeOffers = roster(mine.id).flatMap((out) =>
      roster(theirs.id).map((inc) => ({
        id: `${inc.id}-${out.id}`,
        proposal: { fromTeamId: theirs.id, toTeamId: mine.id, give: [inc.id], get: [out.id] },
        expiresDay: 0,
      })),
    );
    const context = cachedContext(state, ctx, mine.id);
    const worth = (id: string) =>
      ctx.models.valuation.value(state.players[id]!, context, ctx.ruleset).surplus;
    const truth = state.tradeOffers.map(({ proposal: p }) => worth(p.give[0]!) > worth(p.get[0]!));
    const rightShare = (quality: number) => {
      mine.staff = { assistant: { name: 'A B', quality, hired: 2026, salary: 1 } };
      const advice = dashboard(state, ctx, mine.id).todo.filter((i) => i.code.startsWith('advice'));
      expect(advice).toHaveLength(truth.length);
      return advice.filter((a, i) => (a.code === 'adviceTake') === truth[i]).length / truth.length;
    };
    const elite = rightShare(1);
    const poor = rightShare(0);
    expect(elite).toBeGreaterThan(poor + 0.05);
    expect(elite).toBeGreaterThan(0.9);
    // AI GMs have no assistant: their Home gets no advice.
    state.tradeOffers = state.tradeOffers.map((o) => ({
      ...o,
      proposal: { ...o.proposal, fromTeamId: mine.id, toTeamId: theirs.id },
    }));
    const ai = dashboard(state, ctx, theirs.id).todo.map((i) => i.code);
    expect(ai).not.toContain('adviceTake');
    expect(ai).not.toContain('adviceDecline');
  });
});

describe('delegating offers to the assistant GM', () => {
  it('turns down what he advises against, once the toggle is on', () => {
    const state = createLeague(54, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!;
    const theirs = Object.values(state.teams).find((t) => !t.userControlled)!;
    const on = { kind: 'delegate.set', teamId: mine.id, offers: true } as const;
    mine.staff = { assistant: { name: 'A B', quality: 1, hired: 2026, salary: 1 } };
    const give = Object.values(state.players)
      .filter((p) => p.teamId === theirs.id)
      .map((p) => p.id);
    const get = Object.values(state.players)
      .filter((p) => p.teamId === mine.id)
      .map((p) => p.id);
    state.tradeOffers = give.flatMap((g) =>
      get.map((m) => ({
        id: `${g}-${m}`,
        proposal: { fromTeamId: theirs.id, toTeamId: mine.id, give: [g], get: [m] },
        expiresDay: 999,
      })),
    );
    const total = state.tradeOffers.length;
    const advised = (code: string) =>
      dashboard(state, ctx, mine.id).todo.filter((i) => i.code === code).length;
    const against = advised('adviceDecline');
    expect(against).toBeGreaterThan(0);
    expect(against).toBeLessThan(total);
    const r = handleCommand(state, on, local, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) for (const e of r.events) applyEvent(state, e);
    expect(dashboard(state, ctx, mine.id).delegated).toBe(true);
    const events: Parameters<typeof applyEvent>[1][] = [];
    delegatedOffers(state, ctx, (_l, _t, e) => {
      const ev = { ...e, id: 0 } as never;
      events.push(ev);
      applyEvent(state, ev);
    });
    expect(state.tradeOffers).toHaveLength(total - against);
    expect(advised('adviceDecline')).toBe(0);
  });
});

describe('the assistant GM on lines', () => {
  it('names a better player than the top-liner you put there; AI teams get no advice', () => {
    const state = createLeague(57, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!;
    const theirs = Object.values(state.teams).find((t) => !t.userControlled)!;
    const centres = Object.values(state.players)
      .filter((p) => p.teamId === mine.id && p.position === 'C')
      .sort((a, b) => overall(a) - overall(b));
    const worst = centres[0]!;
    state.depthCharts[mine.id] = [worst.id];
    mine.staff = { assistant: { name: 'A B', quality: 1, hired: 2026, salary: 1 } };
    const named = dashboard(state, ctx, mine.id).todo.find((i) => i.code === 'adviceLines');
    const pick = Object.values(state.players).find((p) => playerName(p) === named?.params?.player)!;
    expect(overall(pick)).toBeGreaterThan(overall(worst));
    state.depthCharts[theirs.id] = [
      Object.values(state.players).find((p) => p.teamId === theirs.id && p.position === 'C')!.id,
    ];
    expect(dashboard(state, ctx, theirs.id).todo.map((i) => i.code)).not.toContain('adviceLines');
  });
});

describe('the assistant GM on a trade you build', () => {
  it("guesses their answer on his read: an elite one's guess is right more often than a poor one's", () => {
    const state = createLeague(54, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!;
    const theirs = Object.values(state.teams).find((t) => !t.userControlled)!;
    const roster = (id: string) => Object.values(state.players).filter((p) => p.teamId === id);
    const proposals = roster(mine.id).flatMap((out) =>
      roster(theirs.id).map((inc) => ({
        fromTeamId: mine.id,
        toTeamId: theirs.id,
        give: [out.id],
        get: [inc.id],
      })),
    );
    const truth = proposals.map((p) => evaluateTrade(state, ctx, p).accepted);
    const rightShare = (quality: number) => {
      mine.staff = { assistant: { name: 'A B', quality, hired: 2026, salary: 1 } };
      return (
        proposals.filter((p, i) => assistantGuess(state, ctx, p) === truth[i]).length /
        proposals.length
      );
    };
    const elite = rightShare(1);
    const poor = rightShare(0);
    expect(elite).toBeGreaterThan(poor + 0.03);
    // AI GMs have no assistant: no guess.
    const { fromTeamId, toTeamId, give, get } = proposals[0]!;
    expect(
      assistantGuess(state, ctx, {
        fromTeamId: toTeamId,
        toTeamId: fromTeamId,
        give: get,
        get: give,
      }),
    ).toBeUndefined();
  });
});

describe('a breakout on your team', () => {
  it('asks for an extension in his last year, until he has one', () => {
    const state = createLeague(56, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const p = Object.values(state.players).find((x) => x.teamId === mine && x.contract)!;
    p.contract!.expiresAfterSeason = state.date.season;
    const asks = () => dashboard(state, ctx, mine).todo.filter((i) => i.code === 'breakoutExtend');
    expect(asks()).toHaveLength(0);
    applyEvent(state, {
      id: 'e',
      date: state.date,
      importance: 'minor',
      teamIds: [mine],
      kind: 'player.brokeOut',
      playerId: p.id,
      teamId: mine,
      season: state.date.season,
    });
    expect(asks()).toHaveLength(1);
    p.extension = { ...p.contract! };
    expect(asks()).toHaveLength(0);
  });
});

describe('the assistant GM in free agency', () => {
  it('names a free agent you can afford; AI teams get no advice', () => {
    const state = createLeague(55, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!;
    const theirs = Object.values(state.teams).find((t) => !t.userControlled)!;
    handleCommand(state, { kind: 'sim.advance', days: 300 }, local, ctx);
    handleCommand(state, { kind: 'offseason.openFreeAgency' }, local, ctx);
    const advice = (id = mine.id) =>
      dashboard(state, ctx, id).todo.find((i) => i.code === 'adviceSign');
    expect(advice(theirs.id)).toBeUndefined();
    expect(advice()?.params?.player).toBeTruthy();
    // No cap room, no advice.
    for (const p of Object.values(state.players)) {
      if (p.teamId === mine.id && p.contract) p.contract.capHit = ctx.ruleset.cap.upperLimit;
    }
    expect(advice()).toBeUndefined();
  });
});

describe('sim until it matters', () => {
  it('stops only on league-wide moments, your team, a long injury or an offer to you', () => {
    const state = createLeague(53, ctx);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    let stops = 0;
    while (!state.championTeamId && stops < 40) {
      const res = handleCommand(
        state,
        { kind: 'sim.advance', days: 400, stopOn: 'major' },
        local,
        ctx,
      );
      if (!res.ok) throw new Error(res.error.message);
      const lastDay = res.events.filter((e) => e.date.day === res.events.at(-1)!.date.day);
      const reason = lastDay.some(
        (e) =>
          (e.importance === 'major' && (e.teamIds.length === 0 || e.teamIds.includes(mine))) ||
          (e.kind === 'player.injured' && e.teamIds.includes(mine) && e.days >= 14) ||
          (e.kind === 'trade.offered' && e.teamIds.includes(mine)),
      );
      expect(reason || !!state.championTeamId).toBe(true);
      stops++;
    }
    expect(state.championTeamId).not.toBeNull();
  });
});

describe('streak and highlight news', () => {
  it('appears during a season, the same however you sim it', () => {
    const news = (chunk: number) => {
      const state = createLeague(54, ctx);
      const out: string[] = [];
      for (let d = 0; d < 200; d += chunk) {
        const res = handleCommand(state, { kind: 'sim.advance', days: chunk }, local, ctx);
        if (!res.ok) throw new Error(res.error.message);
        for (const e of res.events) {
          if (e.kind === 'news.posted')
            out.push(`${e.date.day} ${e.headline} ${JSON.stringify(e.params)}`);
        }
      }
      return out;
    };
    const whole = news(200);
    expect(whole).toEqual(news(10));
    for (const key of ['winStreak', 'losingStreak', 'hatTrick', 'shutout', 'slump']) {
      expect(whole.some((l) => l.includes(`event.${key}`))).toBe(true);
    }
  });
});
