import { describe, expect, it } from 'vitest';
import type { Actor, PlayerId } from '@gm/shared';
import { autoLineup, createLeague, defaultContext, handleCommand } from './index';

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
