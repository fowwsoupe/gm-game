import { describe, expect, it } from 'vitest';
import type { Actor, Command, Player, PlayerId, TeamId } from '@gm/shared';
import {
  Rng,
  applyEvent,
  capYearOf,
  createLeague,
  dashboard,
  defaultContext,
  handleCommand,
  hockeySeasonStats,
  prospectsOf,
  type LeagueState,
} from './index';

const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();
const cal = ctx.ruleset.season.calendar;

function run(state: LeagueState, command: Command) {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

/** A league whose season and playoffs are over, played once per seed. A fresh copy each call. */
const played = new Map<number, LeagueState>();
function seasonOver(seed: number) {
  if (!played.has(seed)) {
    const state = createLeague(seed, ctx);
    run(state, { kind: 'sim.advance', days: cal.regularSeasonDays + cal.playoffDays });
    played.set(seed, state);
  }
  const state = structuredClone(played.get(seed)!);
  const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
  return { state, mine };
}

/** Puts a made-up prospect, every rating `rating`, in `teamId`'s pool. */
function addProspect(state: LeagueState, teamId: TeamId, id: string, rating: number, end: number) {
  const base = ctx.sport.generateProspect(new Rng(1), { id, season: state.date.season + 1 });
  const ratings = Object.fromEntries(Object.keys(base.ratings).map((k) => [k, rating]));
  const player: Player = { ...base, teamId, ratings, potential: rating };
  state.prospects[id as PlayerId] = { player, league: 'junior', round: 2, rightsEnd: end };
}

describe('prospect pool', () => {
  it('drafts the class into the pool: rights four summers on at 18, three at 19', () => {
    const { state } = seasonOver(61);
    const replica = structuredClone(state);
    const events = run(state, { kind: 'offseason.openFreeAgency' });
    events.forEach((e) => applyEvent(replica, e));
    expect(replica).toEqual(state);
    const picks = events.flatMap((e) => (e.kind === 'player.drafted' && e.round > 0 ? [e] : []));
    expect(picks.length).toBe(Object.keys(state.teams).length * ctx.ruleset.draft.rounds);
    const ages = new Set<number>();
    for (const e of picks) {
      const age = state.date.season + 1 - e.player.birthYear;
      ages.add(age);
      expect(e.prospect!.rightsEnd).toBe(state.date.season + (age === 18 ? 4 : 3));
      expect(['junior', 'europe']).toContain(e.prospect!.league);
      expect(e.player.contract).toBeUndefined();
      // In the pool, or signed by his team this summer.
      const pr = state.prospects[e.player.id];
      if (pr) expect(state.players[e.player.id]).toBeUndefined();
      else expect(state.players[e.player.id]?.teamId).toBe(e.player.teamId);
    }
    expect([...ages].sort()).toEqual([18, 19]);
  });

  it('an AI team signs a ready prospect and lets an unready one walk when his rights end', () => {
    const { state } = seasonOver(62);
    const ai = Object.values(state.teams).find((t) => !t.userControlled)!.id;
    // Room on the roster and under the cap for him.
    Object.values(state.players)
      .filter((p) => p.teamId === ai)
      .slice(0, 6)
      .forEach((p) => delete state.players[p.id]);
    addProspect(state, ai, 'ready', 85, state.date.season + 3);
    addProspect(state, ai, 'raw', 30, state.date.season);
    const events = run(state, { kind: 'offseason.openFreeAgency' });
    const signed = events.find((e) => e.kind === 'prospect.signed' && e.playerId === 'ready');
    expect(signed?.kind === 'prospect.signed' && signed.teamId).toBe(ai);
    expect(state.players['ready' as PlayerId]?.contract?.capHit).toBe(
      ctx.ruleset.contracts.elcSalary,
    );
    expect(state.players['ready' as PlayerId]?.debut).toBe(state.date.season + 1);
    expect(events.some((e) => e.kind === 'prospect.released' && e.playerId === 'raw')).toBe(true);
    expect(state.prospects['raw' as PlayerId]).toBeUndefined();
    expect(state.players['raw' as PlayerId]?.teamId ?? null).toBeNull();
  });

  it('the human signs one with the command; one whose rights end is a To do, then a free agent', () => {
    const { state, mine } = seasonOver(63);
    addProspect(state, mine, 'last', 50, state.date.season);
    const todo = dashboard(state, ctx, mine).todo.find((x) => x.code === 'prospectRights');
    expect(todo?.params?.count).toBe(1);
    run(state, { kind: 'offseason.openFreeAgency' });
    expect(state.players['last' as PlayerId]?.teamId).toBeNull();

    const pr = prospectsOf(state, mine)[0]!;
    const theirs = Object.values(state.prospects).find((x) => x.player.teamId !== mine)!;
    expect(
      handleCommand(
        state,
        { kind: 'prospect.sign', teamId: mine, playerId: theirs.player.id },
        local,
        ctx,
      ).ok,
    ).toBe(false);
    const events = run(state, { kind: 'prospect.sign', teamId: mine, playerId: pr.player.id });
    expect(events[0]?.kind).toBe('prospect.signed');
    const p = state.players[pr.player.id]!;
    expect(p.teamId).toBe(mine);
    expect(p.contract?.capHit).toBe(ctx.ruleset.contracts.elcSalary);
    expect(p.debut).toBe(capYearOf(state));
    expect(state.prospects[pr.player.id]).toBeUndefined();
  });

  it('the rookie award goes to a player in his first main-league season', () => {
    const { state } = seasonOver(64);
    const season = state.date.season;
    const regular = Object.values(state.results).filter((g) => !g.playoffSeriesId);
    const { skaters } = hockeySeasonStats(regular);
    // A 24-year-old who scored: too old for the old rule, a rookie in his debut season.
    const rookie = Object.values(state.players).find(
      (p) => p.teamId && season - p.birthYear === 24 && skaters.get(p.id)?.goals,
    )!;
    const players = Object.values(state.players).map((p) => ({
      ...p,
      debut: p.id === rookie.id ? season : season - 1,
    }));
    const awards = ctx.sport.pickAwards({
      season,
      rules: ctx.ruleset,
      players,
      results: regular,
      playoffResults: [],
      championTeamId: null,
    });
    expect(awards.find((a) => a.award === 'topRookie')?.playerId).toBe(rookie.id);
  });
});
