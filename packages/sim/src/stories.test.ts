import { describe, expect, it } from 'vitest';
import type { Actor, Command, LeagueEvent } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, storyOf, type LeagueState } from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

function run(state: LeagueState, command: Command, c = ctx) {
  const res = handleCommand(state, command, local, c);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

/**
 * A builder GM's underpaid core player holds out; the GM shops him, and (unless an AI buyer
 * already took him) my team trades for him. Null when that league has no such holdout.
 */
function holdoutToTrade(seed: number) {
  const state = createLeague(seed, ctx);
  const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
  const ai = Object.values(state.teams).find((t) => !t.userControlled)!;
  ai.gm = { style: 'builder', skill: 1 };
  for (const p of Object.values(state.players)) {
    if (p.teamId !== ai.id || !p.contract) continue;
    p.contract = { capHit: ctx.ruleset.cap.minSalary, expiresAfterSeason: state.date.season };
  }
  const events = run(state, { kind: 'sim.advance', days: 1 - state.date.day });
  const h = state.holdouts.find((x) => x.teamId === ai.id);
  if (!h) return null;
  events.push(...run(state, { kind: 'sim.advance', days: 6 }));
  const gaveUp = events.some((e) => e.kind === 'player.holdoutEnded' && e.playerId === h.playerId);
  if (gaveUp) return null;
  if (state.players[h.playerId]!.teamId === ai.id) {
    const give = Object.values(state.players).find((p) => p.teamId === mine)!.id;
    const proposal = { fromTeamId: mine, toTeamId: ai.id, give: [give], get: [h.playerId] };
    // The builder wants the player he gets, and nothing else counts.
    const generous = defaultContext(ctx.ruleset.id, {
      models: {
        valuation: {
          value: (p) => ({ surplus: p.id === give ? 50_000_000 : 0, reasons: [] }),
        },
      },
    });
    events.push(...run(state, { kind: 'trade.propose', proposal }, generous));
  }
  return { events, playerId: h.playerId, season: state.date.season };
}

let found: number | undefined;
function holdoutLeague() {
  for (let seed = 1; seed < 40 && found === undefined; seed++) {
    if (holdoutToTrade(seed)) found = seed;
  }
  if (found === undefined) throw new Error('no AI holdout in 40 seeds');
  return holdoutToTrade(found)!;
}

describe('storylines', () => {
  it('a holdout that ends in a trade is one story, with the GM answering in it', () => {
    const { events, playerId, season } = holdoutLeague();
    const stories = storyOf(events);
    const key = `holdout:${playerId}:${season}`;
    const story = events.filter((e) => stories[e.id] === key);
    const headline = (e: LeagueEvent) => (e.kind === 'news.posted' ? e.headline : e.kind);
    expect(story.map(headline)).toEqual([
      'player.holdoutStarted',
      'event.holdoutShopped',
      'event.trade',
    ]);
    const answer = story[1]!;
    expect(answer.kind === 'news.posted' && answer.by?.role).toBe('gm');
    // A replay of the same league threads the same posts under the same keys.
    expect(storyOf(holdoutLeague().events)).toEqual(stories);
    // Newest first (as the feed reads them) gives the same answer.
    expect(storyOf([...events].reverse())).toEqual(stories);
  });

  it("a fire sale threads that season's trades sending players out, not the next season's", () => {
    let seq = 0;
    const at = (season: number, body: object) =>
      ({
        id: `ev_${season}_100_${String(seq++).padStart(4, '0')}`,
        date: { season, day: 100 },
        importance: 'notable',
        teamIds: ['t1'],
        ...body,
      }) as LeagueEvent;
    const trade = (season: number, from: string, to: string, give: string[], get: string[]) => [
      at(season, { kind: 'trade.completed', fromTeamId: from, toTeamId: to, give, get }),
      at(season, { kind: 'news.posted', headline: 'event.trade' }),
    ];
    const sale = at(2027, { kind: 'news.posted', headline: 'event.fireSale' });
    const out = trade(2027, 't2', 't1', ['p9'], ['p1']); // t1 sends p1 away
    const into = trade(2027, 't3', 't1', ['p8'], []); // t1 only takes a player in
    const later = trade(2028, 't2', 't1', ['p7'], ['p2']);
    const stories = storyOf([sale, ...out, ...into, ...later]);
    expect(stories[sale.id]).toBe('fireSale:t1:2027');
    expect(stories[out[1]!.id]).toBe('fireSale:t1:2027');
    expect(stories[into[1]!.id]).toBeUndefined();
    expect(stories[later[1]!.id]).toBeUndefined();
  });
});
