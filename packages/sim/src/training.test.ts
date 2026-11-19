import { describe, expect, it } from 'vitest';
import type { Actor, Command, LeagueEvent, TeamId } from '@gm/shared';
import {
  createLeague,
  defaultContext,
  emitter,
  handleCommand,
  Rng,
  type LeagueState,
} from './index';
import { developPlayers, trainFocus } from './offseason';
import { overall } from './players';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

/** A league with one human team and one of its young skaters well under his ceiling on shooting. */
function league() {
  // The first seed that has such a skater: how many do depends on how prospects are drawn.
  for (let seed = 1; ; seed++) {
    const state = createLeague(seed, ctx);
    const [mine, other] = Object.keys(state.teams).sort() as [TeamId, TeamId];
    state.teams[mine]!.userControlled = true;
    const player = Object.values(state.players).find(
      (p) =>
        p.teamId === mine &&
        p.ratings.shooting !== undefined &&
        state.date.season - p.birthYear <= 24 &&
        p.ratings.shooting < p.potential - 12,
    );
    if (player) return { state, mine, other, player };
  }
}

/** One summer's development of a copy of `base` after `setup`: the copy and its events. */
function summer(base: LeagueState, setup: (s: LeagueState) => void = () => {}) {
  const state = structuredClone(base);
  setup(state);
  const events: LeagueEvent[] = [];
  developPlayers(state, ctx, new Rng(7), emitter(state, events), state.date.season + 1);
  return { state, events };
}

const command = (state: LeagueState, c: Command) => handleCommand(state, c, local, ctx);

describe('summer training plans', () => {
  it('a shooting focus raises his shooting against his balanced twin, overall the same', () => {
    const { state, mine, player } = league();
    const plain = summer(state).state;
    const { state: focused, events } = summer(state, (s) =>
      command(s, { kind: 'training.set', teamId: mine, playerId: player.id, focus: 'shooting' }),
    );
    const [a, b] = [plain.players[player.id]!, focused.players[player.id]!];
    expect(b.ratings.shooting!).toBeGreaterThan(a.ratings.shooting!);
    expect(overall(b)).toBeCloseTo(overall(a), 6);
    expect(
      events.some((e) => e.kind === 'news.posted' && e.headline === 'event.summerTraining'),
    ).toBe(true);
    // Nobody else changes.
    for (const p of Object.values(plain.players)) {
      if (p.id !== player.id) expect(focused.players[p.id]!.ratings).toEqual(p.ratings);
    }
  });

  it('a focus key at his potential gains nothing; under it the points move, the sum holds', () => {
    const at = trainFocus({ shooting: 80, skating: 70, passing: 60 }, ['shooting'], 80, 2);
    expect(at).toEqual({ ratings: { shooting: 80, skating: 70, passing: 60 }, gained: 0 });
    const under = trainFocus({ shooting: 70, skating: 70, passing: 60 }, ['shooting'], 80, 2);
    expect(under.gained).toBe(2);
    expect(under.ratings).toEqual({ shooting: 72, skating: 69, passing: 59 });
  });

  it('a plan on a player traded to an AI team does nothing', () => {
    const { state, mine, other, player } = league();
    const plain = summer(state, (s) => (s.players[player.id]!.teamId = other)).state;
    const planned = summer(state, (s) => {
      command(s, { kind: 'training.set', teamId: mine, playerId: player.id, focus: 'shooting' });
      s.players[player.id]!.teamId = other;
    }).state;
    expect(planned.players[player.id]!.ratings).toEqual(plain.players[player.id]!.ratings);
  });

  it('only your own players, only the sport’s focuses; null goes back to balanced', () => {
    const { state, mine, other, player } = league();
    const theirs = Object.values(state.players).find((p) => p.teamId === other)!;
    const set = (playerId: typeof player.id, focus: string | null, teamId = mine) =>
      command(state, { kind: 'training.set', teamId, playerId, focus });
    expect(set(theirs.id, 'shooting').ok).toBe(false);
    expect(set(theirs.id, 'shooting', other).ok).toBe(false);
    expect(set(player.id, 'reflexes').ok).toBe(false);
    expect(set(player.id, 'constructor').ok).toBe(false);
    expect(set(player.id, 'playmaking').ok).toBe(true);
    expect(state.trainingPlans[player.id]).toBe('playmaking');
    expect(set(player.id, null).ok).toBe(true);
    expect(state.trainingPlans[player.id]).toBeUndefined();
  });
});
