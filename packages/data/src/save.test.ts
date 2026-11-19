import { describe, expect, it } from 'vitest';
import type { Actor, Command, PlayerId, TeamId } from '@gm/shared';
import { Rng, createLeague, defaultContext, handleCommand } from '@gm/sim';
import { openSave } from './index';
import { migrations } from './migrations';

const ctx = defaultContext();
const local: Actor = { id: 'local', controls: [] };

describe('SaveFile', () => {
  it('saves a new league and loads the identical state back', () => {
    const save = openSave(':memory:');
    const state = createLeague(4, ctx);
    save.saveNewLeague(state);
    expect(save.loadState()).toEqual(state);
    save.close();
  });

  it('persists a renamed team', () => {
    const save = openSave(':memory:');
    const state = createLeague(4, ctx);
    save.saveNewLeague(state);
    const teamId = Object.keys(state.teams)[0] as TeamId;
    const res = handleCommand(
      state,
      { kind: 'team.rename', teamId, city: 'Québec', name: 'Fleuves', abbreviation: 'QBF' },
      local,
      ctx,
    );
    if (!res.ok) throw new Error(res.error.message);
    save.persist(res.events, state);
    expect(save.loadState()).toEqual(state);
    save.close();
  });

  it('hot-seat: a second human GM shares the save and both teams stay human', () => {
    const save = openSave(':memory:');
    const state = createLeague(4, ctx);
    save.saveNewLeague(state);
    const second = Object.values(state.teams).find((t) => !t.userControlled)!.id;
    const res = handleCommand(
      state,
      { kind: 'team.setUserControlled', teamId: second, userControlled: true },
      local,
      ctx,
    );
    if (!res.ok) throw new Error(res.error.message);
    save.persist(res.events, state);
    const sim = handleCommand(state, { kind: 'sim.advance', days: 3 }, local, ctx);
    if (!sim.ok) throw new Error(sim.error.message);
    save.persist(sim.events, state);
    const loaded = save.loadState();
    expect(Object.values(loaded.teams).filter((t) => t.userControlled)).toHaveLength(2);
    expect(loaded).toEqual(state);
    save.close();
  });

  it('persists a relocated team', () => {
    const save = openSave(':memory:');
    const state = createLeague(4, ctx);
    save.saveNewLeague(state);
    const teamId = Object.keys(state.teams)[0] as TeamId;
    const res = handleCommand(
      state,
      {
        kind: 'team.relocate',
        teamId,
        city: 'Houston',
        name: 'Comets',
        abbreviation: 'HOU',
        market: 1.4,
      },
      local,
      ctx,
    );
    if (!res.ok) throw new Error(res.error.message);
    save.persist(res.events, state);
    expect(save.loadState()).toEqual(state);
    save.close();
  });

  it('persists an expansion team and the players it drafted', () => {
    const save = openSave(':memory:');
    const state = createLeague(4, ctx);
    save.saveNewLeague(state);
    const open = handleCommand(state, { kind: 'sim.advance', days: 400 }, local, ctx);
    if (!open.ok) throw new Error(open.error.message);
    const fa = handleCommand(state, { kind: 'offseason.openFreeAgency' }, local, ctx);
    if (!fa.ok) throw new Error(fa.error.message);
    save.persist([...open.events, ...fa.events], state);
    const res = handleCommand(
      state,
      { kind: 'league.expand', city: 'Houston', name: 'Comets', abbreviation: 'HOU', market: 1.4 },
      local,
      ctx,
    );
    if (!res.ok) throw new Error(res.error.message);
    save.persist(res.events, state);
    expect(save.loadState()).toEqual(state);
    save.close();
  });

  it('persists events so a reopened save matches the live state', () => {
    const save = openSave(':memory:');
    const state = createLeague(8, ctx);
    save.saveNewLeague(state);
    const res = handleCommand(state, { kind: 'sim.advance', days: 20 }, local, ctx);
    if (!res.ok) throw new Error(res.error.message);
    save.persist(res.events, state);
    expect(save.loadState()).toEqual(state);
    save.close();
  });

  it("reads a team's owner history from a year-20 log inside the screen budget", () => {
    const save = openSave(':memory:');
    const state = createLeague(4, ctx);
    save.saveNewLeague(state);
    const res = handleCommand(state, { kind: 'sim.advance', days: 252 }, local, ctx);
    if (!res.ok) throw new Error(res.error.message);
    save.persist(res.events, state);
    const teamId = Object.keys(state.teams)[0] as TeamId;
    const season = save.ownerHistory(teamId);
    // Months 0, 30 ... 180, the regular season's end, and the playoffs; three meetings.
    expect(season.money).toHaveLength(9);
    expect(season.meetings.map((m) => m.meeting)).toEqual(['preseason', 'deadline', 'review']);
    // The same season's log 19 more times: a save 20 years in.
    save.db.exec(`
      WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM n WHERE k < 19)
      INSERT INTO events (id, season, day, kind, importance, team_ids, payload_json)
      SELECT e.id || '-' || n.k, e.season + n.k, e.day, e.kind, e.importance, e.team_ids,
             e.payload_json
      FROM events e, n WHERE e.season = ${state.date.season}`);
    const t0 = performance.now();
    const years = save.ownerHistory(teamId);
    const ms = performance.now() - t0;
    expect(years.money).toHaveLength(180);
    expect(years.meetings).toHaveLength(60);
    expect(ms).toBeLessThan(200);
    save.close();
  });

  it('keeps the stop filter across a save and load', () => {
    const save = openSave(':memory:');
    const state = createLeague(4, ctx);
    save.saveNewLeague(state);
    const res = handleCommand(
      state,
      { kind: 'league.setStopOn', stopOn: ['injuries'] },
      local,
      ctx,
    );
    if (!res.ok) throw new Error(res.error.message);
    save.persist(res.events, state);
    expect(save.loadState().stopOn).toEqual(['injuries']);
    save.close();
  });

  it('saves a trade', () => {
    const save = openSave(':memory:');
    const state = createLeague(8, ctx);
    save.saveNewLeague(state);
    // Every player is worth a lot to this partner, so a gift is always accepted.
    const generous = defaultContext(ctx.ruleset.id, {
      models: { valuation: { value: () => ({ surplus: 50_000_000, reasons: [] }) } },
    });
    const teams = Object.values(state.teams);
    const from = teams.find((t) => t.userControlled)!.id;
    const to = teams.find((t) => !t.userControlled)!.id;
    const cheapest = Object.values(state.players)
      .filter((p) => p.teamId === from && p.position === 'C')
      .sort((a, b) => a.contract!.capHit - b.contract!.capHit)[0]!;
    const res = handleCommand(
      state,
      {
        kind: 'trade.propose',
        proposal: {
          fromTeamId: from,
          toTeamId: to,
          give: [cheapest.id],
          get: [],
          retain: [{ playerId: cheapest.id, pct: 25 }],
          givePicks: [`${state.date.season + 1}-1-${from}`],
        },
      },
      local,
      generous,
    );
    if (!res.ok) throw new Error(res.error.message);
    save.persist(res.events, state);
    expect(save.loadState().players[cheapest.id]!.teamId).toBe(to);
    expect(save.loadState().capCharges.some((c) => c.kind === 'retained')).toBe(true);
    expect(save.loadState()).toEqual(state);
    save.close();
  });

  it('saves an in-season extension', () => {
    const save = openSave(':memory:');
    const state = createLeague(61, ctx);
    save.saveNewLeague(state);
    const sim = handleCommand(state, { kind: 'sim.advance', days: 40 }, local, ctx);
    if (!sim.ok) throw new Error(sim.error.message);
    save.persist(sim.events, state);
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    const expiring = Object.values(state.players).find(
      (p) => p.teamId === mine && p.contract!.expiresAfterSeason === state.date.season,
    )!;
    // At his current salary, then (if his agent counters, kept in the save as talks) his counter.
    let salary = expiring.contract!.capHit;
    for (let round = 0; round < 2 && !state.players[expiring.id]!.extension; round++) {
      const res = handleCommand(
        state,
        { kind: 'contract.resign', playerId: expiring.id, salary, years: 2 },
        local,
        ctx,
      );
      if (!res.ok) throw new Error(res.error.message);
      save.persist(res.events, state);
      const ev = res.events[0]!;
      if (ev.kind === 'contract.countered') salary = ev.counter ?? salary;
    }
    expect(save.loadState().players[expiring.id]!.extension).toBeDefined();
    expect(save.loadState()).toEqual(state);
    save.close();
  });

  it('saves the free-agency window and closes it with the new season', () => {
    const save = openSave(':memory:');
    const state = createLeague(12, ctx);
    save.saveNewLeague(state);
    for (const command of [
      { kind: 'sim.advance', days: 300 },
      { kind: 'offseason.openFreeAgency' },
    ] as const) {
      const res = handleCommand(state, command, local, ctx);
      if (!res.ok) throw new Error(res.error.message);
      save.persist(res.events, state);
    }
    expect(save.loadState().freeAgencyOpen).toBe(true);
    expect(save.loadState()).toEqual(state);
    // The season's lines are archived for career stats, and kept out of the event log.
    const scorer = Object.values(state.players).find((p) => p.teamId && p.position === 'C')!;
    expect(save.careerLines(scorer.id)).toMatchObject([{ season: state.date.season }]);
    expect(save.careerLines(scorer.id)[0]!.stats.gp).toBeGreaterThan(0);
    // Players who retired this summer keep their careers for the Hall of Fame.
    const retired = save.retiredCareers();
    expect(retired.length).toBeGreaterThan(0);
    expect(retired.some((c) => c.lines.length > 0)).toBe(true);
    const logged = save.listEvents(5000).find((e) => e.kind === 'stats.archived');
    expect(logged).toBeDefined();
    expect(logged).not.toHaveProperty('lines');
    const res = handleCommand(state, { kind: 'season.rollover' }, local, ctx);
    if (!res.ok) throw new Error(res.error.message);
    save.persist(res.events, state);
    expect(save.loadState().freeAgencyOpen).toBe(false);
    expect(save.loadState()).toEqual(state);
    save.close();
  });

  it('saves the prospect pool: picks wait in it, then sign or walk and get their row', () => {
    const save = openSave(':memory:');
    const state = createLeague(13, ctx);
    save.saveNewLeague(state);
    const step = (command: Command) => {
      const res = handleCommand(state, command, local, ctx);
      if (!res.ok) throw new Error(res.error.message);
      save.persist(res.events, state);
    };
    const mine = Object.values(state.teams).find((t) => t.userControlled)!.id;
    // A prospect of yours whose rights end this summer: he plays a junior season, then walks
    // when free agency opens.
    const player = ctx.sport.generateProspect(new Rng(1), {
      id: 'gone',
      season: state.date.season + 1,
    });
    state.prospects['gone' as PlayerId] = {
      player: { ...player, teamId: mine },
      league: 'junior',
      round: 2,
      rightsEnd: state.date.season,
    };
    step({ kind: 'sim.advance', days: 300 });
    const junior = state.prospects['gone' as PlayerId]!.line!;
    expect(junior).toMatchObject({ season: state.date.season, league: 'junior' });
    step({ kind: 'offseason.openFreeAgency' });
    expect(state.players['gone' as PlayerId]?.teamId).toBeNull();
    expect(save.careerLines('gone')).toEqual([{ ...junior, teamId: null }]);
    const pick = Object.values(state.prospects).find((x) => x.player.teamId === mine)!;
    step({ kind: 'prospect.sign', teamId: mine, playerId: pick.player.id });
    expect(state.players[pick.player.id]?.debut).toBeDefined();
    // His draft-year line is the first row of his career.
    expect(save.careerLines(pick.player.id)).toEqual([{ ...pick.line!, teamId: null }]);
    // Sent down, he keeps the league he came from and the one he plays in now.
    step({ kind: 'player.assign', teamId: mine, playerId: pick.player.id, down: true });
    expect(state.players[pick.player.id]?.league).toBeDefined();
    expect(state.players[pick.player.id]?.origin).toBe(pick.league);
    expect(save.loadState()).toEqual(state);
    save.close();
  });

  it('resumes a playoff series and saves the champion', () => {
    const save = openSave(':memory:');
    const state = createLeague(17, ctx);
    save.saveNewLeague(state);
    // From camp into the playoffs, then to the champion.
    for (const days of [ctx.ruleset.season.calendar.regularSeasonDays + 2 - state.date.day, 30]) {
      const res = handleCommand(state, { kind: 'sim.advance', days }, local, ctx);
      if (!res.ok) throw new Error(res.error.message);
      save.persist(res.events, state);
      expect(save.loadState()).toEqual(state);
    }
    expect(state.championTeamId).not.toBeNull();
    const resumed = save.loadState();
    const direct = handleCommand(state, { kind: 'sim.advance', days: 5 }, local, ctx);
    const afterLoad = handleCommand(resumed, { kind: 'sim.advance', days: 5 }, local, ctx);
    expect(afterLoad).toEqual(direct);
    expect(resumed).toEqual(state);
    save.close();
  });

  it('saves a full offseason and loads the identical league, then plays on the same way', () => {
    const save = openSave(':memory:');
    const state = createLeague(21, ctx);
    save.saveNewLeague(state);
    const { regularSeasonDays, playoffDays } = ctx.ruleset.season.calendar;
    for (const command of [
      { kind: 'sim.advance', days: regularSeasonDays + playoffDays },
      { kind: 'season.rollover' },
      { kind: 'sim.advance', days: regularSeasonDays + playoffDays },
      { kind: 'season.rollover' },
    ] as const) {
      const res = handleCommand(state, command, local, ctx);
      if (!res.ok) throw new Error(res.error.message);
      save.persist(res.events, state);
      expect(save.loadState()).toEqual(state);
    }
    expect(state.date.season).toBe(2029);
    const awards = save.listAwards();
    expect(awards.filter((a) => a.season === 2027).map((a) => a.award)).toEqual([
      'champion',
      'mvp',
      'topGoalie',
      'topDefender',
      'topRookie',
      'playoffMvp',
    ]);
    expect(awards[0]!.season).toBe(2028);
    expect(awards.find((a) => a.award === 'mvp')!.playerName).toMatch(/\S+ \S+/);
    const resumed = save.loadState();
    const direct = handleCommand(state, { kind: 'sim.advance', days: 30 }, local, ctx);
    const afterLoad = handleCommand(resumed, { kind: 'sim.advance', days: 30 }, local, ctx);
    expect(afterLoad).toEqual(direct);
    save.close();
  }, 30_000); // two full seasons: ~4 s locally, too close to the 5 s default under load

  it('filters the event log by importance', () => {
    const save = openSave(':memory:');
    const state = createLeague(8, ctx);
    save.saveNewLeague(state);
    const res = handleCommand(state, { kind: 'sim.advance', days: 30 }, local, ctx);
    if (!res.ok) throw new Error();
    save.persist(res.events, state);
    expect(save.listEvents(1000).length).toBeGreaterThan(0);
    const notable = save.listEvents(1000, 'notable');
    expect(notable.length).toBeGreaterThan(0);
    for (const e of notable) expect(e.importance).not.toBe('minor');
    save.close();
  });

  it('migration 9 gives existing skaters a faceoffs rating without moving their overall', () => {
    const save = openSave(':memory:');
    const state = createLeague(9, ctx);
    save.saveNewLeague(state);
    // Make it look like a save from before migration 9.
    save.db.exec(`UPDATE players SET ratings_json = json_remove(ratings_json, '$.faceoffs')`);
    save.db.exec(migrations[8]!); // migration 9 only: later ones are not meant to run twice
    for (const p of save.listPlayers()) {
      if (p.position === 'G') {
        expect(p.ratings.faceoffs).toBeUndefined();
        continue;
      }
      const { faceoffs, ...others } = p.ratings;
      const values = Object.values(others);
      expect(faceoffs).toBe(Math.round(values.reduce((a, b) => a + b, 0) / values.length));
    }
    save.close();
  });

  it('saves a buyout and its dead cap, and drops past seasons at the rollover', () => {
    const save = openSave(':memory:');
    const state = createLeague(21, ctx);
    save.saveNewLeague(state);
    const played = handleCommand(state, { kind: 'sim.advance', days: 260 }, local, ctx);
    if (!played.ok) throw new Error(played.error.message);
    save.persist(played.events, state);
    const target = Object.values(state.players).find(
      (p) =>
        p.teamId &&
        state.teams[p.teamId]!.userControlled &&
        p.contract!.expiresAfterSeason > state.date.season,
    )!;
    const bought = handleCommand(
      state,
      { kind: 'contract.buyout', playerId: target.id },
      local,
      ctx,
    );
    if (!bought.ok) throw new Error(bought.error.message);
    save.persist(bought.events, state);
    expect(state.capCharges.length).toBeGreaterThan(0);
    expect(save.loadState()).toEqual(state);
    const rolled = handleCommand(state, { kind: 'season.rollover' }, local, ctx);
    if (!rolled.ok) throw new Error(rolled.error.message);
    save.persist(rolled.events, state);
    expect(save.loadState()).toEqual(state);
    save.close();
  });
});

describe('player history', () => {
  it("lists a drafted player's signing and the awards he won, oldest first", () => {
    const save = openSave(':memory:');
    const state = createLeague(11, ctx);
    save.saveNewLeague(state);
    const { regularSeasonDays, playoffDays } = ctx.ruleset.season.calendar;
    for (const command of [
      { kind: 'sim.advance', days: regularSeasonDays + playoffDays },
      { kind: 'season.rollover' },
    ] as const) {
      const res = handleCommand(state, command, local, ctx);
      if (!res.ok) throw new Error(res.error.message);
      save.persist(res.events, state);
    }
    const mvp = save.listAwards().find((a) => a.award === 'mvp')!;
    const history = save.playerHistory(mvp.playerId!);
    expect(history.awards).toContainEqual({ season: mvp.season, award: 'mvp' });
    expect(save.playerHistory('nobody')).toEqual({ awards: [], moves: [] });
    // A pick, signed or still in the prospect pool.
    const drafted = Object.values(state.prospects)[0]!.player;
    expect(save.playerHistory(drafted.id).moves[0]).toMatchObject({ kind: 'drafted' });
    // The draft results: every pick of this summer's draft, in order.
    const latest = save.latestDraft();
    expect(latest.season).toBe(state.date.season);
    expect(latest.picks.map((p) => p.pick)).toEqual(
      Array.from(
        { length: Object.keys(state.teams).length * ctx.ruleset.draft.rounds },
        (_, i) => i + 1,
      ),
    );
    save.close();
  });
});
