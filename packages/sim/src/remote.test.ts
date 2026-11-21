import { describe, expect, it } from 'vitest';
import type { Actor, Command, Grant, PlayerId, TeamId } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, type LeagueState } from './index';
import { freeAgencyLeague, summerLeague } from './testLeagues';

/**
 * A guest of a hosted league: an actor who is not `local`, seated by the host on one team. What
 * he may do is his own team's business, plus the clock if the host granted him `advance`.
 */
const ctx = defaultContext();
const guest = (teamId: TeamId, can: Grant[] = []): Actor => ({
  id: 'peer-1',
  controls: [teamId],
  can,
});

/** Two human teams, the guest's and another GM's, and a player of each. */
function seats(state: LeagueState) {
  const [mine, theirs] = Object.keys(state.teams).sort() as [TeamId, TeamId];
  state.teams[mine]!.userControlled = true;
  state.teams[theirs]!.userControlled = true;
  const playerOf = (teamId: TeamId) =>
    Object.values(state.players).find((p) => p.teamId === teamId && !p.league)!.id;
  return { mine, theirs, myPlayer: playerOf(mine), theirPlayer: playerOf(theirs) };
}

/** The command's refusal code, or 'ok'; a refused command must leave the league as it was. */
function attempt(state: LeagueState, command: Command, actor: Actor) {
  const before = structuredClone(state);
  const res = handleCommand(state, command, actor, ctx);
  if (res.ok) return 'ok';
  expect(state).toEqual(before);
  return res.error.code;
}

describe('a remote GM and the clock', () => {
  const clock: { command: Command; league: (seed: number) => LeagueState }[] = [
    { command: { kind: 'sim.advance', days: 1 }, league: (seed) => createLeague(seed, ctx) },
    { command: { kind: 'offseason.startDraft' }, league: summerLeague },
    { command: { kind: 'offseason.openFreeAgency' }, league: summerLeague },
    { command: { kind: 'freeAgency.advanceDay' }, league: freeAgencyLeague },
    { command: { kind: 'season.rollover' }, league: summerLeague },
  ];

  it.each(clock)(
    '$command.kind: refused without the grant, runs with it',
    ({ command, league }) => {
      const state = league(4);
      const { mine } = seats(state);
      expect(attempt(state, command, guest(mine))).toBe('not_allowed');
      expect(attempt(state, command, guest(mine, ['advance']))).toBe('ok');
    },
  );
});

describe('a remote GM, whatever he was granted', () => {
  it('cannot use a commissioner tool', () => {
    const state = freeAgencyLeague(4);
    const { mine, theirs, theirPlayer } = seats(state);
    const identity = { city: 'Houston', name: 'Comets', abbreviation: 'HOU' };
    const tools: Command[] = [
      { kind: 'league.expand', ...identity, market: 1 },
      { kind: 'commissioner.move', playerId: theirPlayer, teamId: mine },
      { kind: 'career.takeJob', teamId: theirs },
      { kind: 'league.setCanBeFired', on: false },
      { kind: 'league.setStopOn', stopOn: [] },
    ];
    for (const tool of tools) {
      expect(attempt(state, tool, guest(mine, ['advance'])), tool.kind).toBe('not_allowed');
    }
  });

  it('renames his own team but cannot relocate it', () => {
    const state = createLeague(4, ctx);
    const { mine } = seats(state);
    const identity = { teamId: mine, city: 'Houston', name: 'Comets', abbreviation: 'HOU' };
    const actor = guest(mine, ['advance']);
    expect(attempt(state, { kind: 'team.relocate', ...identity, market: 1.75 }, actor)).toBe(
      'not_allowed',
    );
    expect(attempt(state, { kind: 'team.rename', ...identity }, actor)).toBe('ok');
    expect(state.teams[mine]).toMatchObject({ city: 'Houston', abbreviation: 'HOU' });
  });

  it("cannot act for another GM's team", () => {
    const state = createLeague(4, ctx);
    const { mine, theirs, myPlayer, theirPlayer } = seats(state);
    const identity = { city: 'Houston', name: 'Comets', abbreviation: 'HOU' };
    const forTeam = (teamId: TeamId, playerId: PlayerId): Command[] => [
      { kind: 'lines.set', teamId, order: [playerId] },
      { kind: 'trade.block', teamId, playerId, onBlock: true },
      { kind: 'finance.setTicketPrice', teamId, pct: 20 },
      { kind: 'goalies.setRotation', teamId, rotation: 'split' },
      { kind: 'delegate.set', teamId, offers: false },
      { kind: 'player.assign', teamId, playerId, down: true },
      { kind: 'team.rename', teamId, ...identity },
      { kind: 'team.setUserControlled', teamId, userControlled: false },
    ];
    const actor = guest(mine, ['advance']);
    for (const command of forTeam(theirs, theirPlayer)) {
      expect(attempt(state, command, actor), command.kind).toBe('not_allowed');
    }
    // His trade offer is his to send, not the other GM's.
    const swap = { give: [theirPlayer], get: [myPlayer] };
    const asThem = { fromTeamId: theirs, toTeamId: mine, ...swap };
    expect(attempt(state, { kind: 'trade.propose', proposal: asThem }, actor)).toBe('not_allowed');
    // The same commands for his own team go through.
    for (const command of forTeam(mine, myPlayer)) {
      expect(attempt(state, command, actor), command.kind).toBe('ok');
    }
  });
});
