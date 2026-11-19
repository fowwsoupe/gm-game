import { describe, expect, it } from 'vitest';
import type { Actor, Command, PlayerId, TeamId } from '@gm/shared';
import { createLeague, defaultContext, handleCommand, overall, type LeagueState } from './index';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };
const cal = ctx.ruleset.season.calendar;
const { protect, picks, maxLossPerTeam } = ctx.ruleset.expansion;
const expand: Command = {
  kind: 'league.expand',
  city: 'Houston',
  name: 'Comets',
  abbreviation: 'HOU',
  market: 1.4,
};

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

describe('league.expand', () => {
  it('adds a team that drafts unprotected players, then plays a full season', () => {
    const state = createLeague(3, ctx);
    const before = Object.keys(state.teams).length;
    run(state, { kind: 'sim.advance', days: cal.regularSeasonDays + cal.playoffDays });
    expect(handleCommand(state, expand, local, ctx).ok).toBe(false); // free agency is not open
    run(state, { kind: 'offseason.openFreeAgency' });
    const taken = { ...expand, abbreviation: Object.values(state.teams)[1]!.abbreviation };
    expect(handleCommand(state, taken, local, ctx).ok).toBe(false);
    expect(handleCommand(state, expand, { id: 'remote', controls: [] }, ctx).ok).toBe(false);

    const was = new Map<PlayerId, TeamId>();
    const kept = new Set<PlayerId>();
    for (const t of Object.keys(state.teams) as TeamId[]) {
      const roster = Object.values(state.players).filter((p) => p.teamId === t && p.contract);
      roster.sort((a, b) => overall(b) - overall(a));
      roster.forEach((p, i) => {
        was.set(p.id, t);
        if (i < protect) kept.add(p.id);
      });
    }
    const [ev] = run(state, expand);
    if (ev?.kind !== 'team.expanded') throw new Error('expected team.expanded');
    const id = ev.team.id;
    expect(Object.keys(state.teams)).toHaveLength(before + 1);
    expect(state.teams[id]).toMatchObject({ city: 'Houston', market: 1.4, userControlled: false });
    expect(ev.team.division).toBeTruthy();
    expect(ev.taken.length).toBeGreaterThan(0);
    expect(ev.taken.length).toBeLessThanOrEqual(picks);
    const lost = new Map<TeamId, number>();
    for (const pid of ev.taken) {
      expect(state.players[pid]?.teamId).toBe(id);
      expect(kept.has(pid)).toBe(false);
      lost.set(was.get(pid)!, (lost.get(was.get(pid)!) ?? 0) + 1);
    }
    expect(Math.max(...lost.values())).toBeLessThanOrEqual(maxLossPerTeam);
    expect(handleCommand(state, { ...expand, abbreviation: 'NEW' }, local, ctx).ok).toBe(true);
    const second = Object.values(state.teams).find((t) => t.abbreviation === 'NEW')!;
    expect(second.id).not.toBe(id);

    run(state, { kind: 'season.rollover' });
    expect(
      Object.values(state.players).filter((p) => p.teamId === id).length,
    ).toBeGreaterThanOrEqual(ctx.ruleset.roster.minActive);
    run(state, { kind: 'sim.advance', days: cal.regularSeasonDays + cal.preseasonDays });
    const games = Object.values(state.results).filter(
      (g) => !g.playoffSeriesId && (g.homeTeamId === id || g.awayTeamId === id),
    );
    expect(games).toHaveLength(ctx.ruleset.season.gamesPerTeam);
  }, 90_000);

  it('stops at the ruleset team limit', () => {
    const state = createLeague(5, ctx);
    state.freeAgencyOpen = true;
    const small = {
      ...ctx,
      ruleset: { ...ctx.ruleset, expansion: { ...ctx.ruleset.expansion, maxTeams: 16 } },
    };
    expect(handleCommand(state, expand, local, small).ok).toBe(false);
  });
});

describe('commissioner.move', () => {
  it('moves a player to any team or to free agency, local actor only', () => {
    const state = createLeague(3, ctx);
    const [a, b] = Object.keys(state.teams) as TeamId[];
    const p = Object.values(state.players).find((x) => x.teamId === a && x.contract)!;
    const move = (teamId: TeamId | null): Command => ({
      kind: 'commissioner.move',
      playerId: p.id,
      teamId,
    });
    expect(handleCommand(state, move(b!), { id: 'remote', controls: [] }, ctx).ok).toBe(false);
    expect(handleCommand(state, move(a!), local, ctx).ok).toBe(false);
    run(state, move(b!));
    expect(state.players[p.id]?.teamId).toBe(b);
    run(state, move(null));
    expect(state.players[p.id]?.teamId).toBeNull();
    expect(state.players[p.id]?.contract).toBeUndefined();
    expect(handleCommand(state, move(a!), local, ctx).ok).toBe(false); // not rostered
  });
});
