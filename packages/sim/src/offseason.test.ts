import { describe, expect, it } from 'vitest';
import type { Actor, LeagueEvent, TeamId } from '@gm/shared';
import {
  applyEvent,
  computeStandings,
  createLeague,
  defaultContext,
  elcYears,
  handleCommand,
  hockeySeasonStats,
  lotteryOrder,
  playoffCapBreaches,
  Rng,
  playerRecords,
  teamRecords,
  validateContract,
  type LeagueState,
} from './index';

const local: Actor = { id: 'local', controls: [] };
const ctx = defaultContext();
const { ruleset } = ctx;
const calendar = ruleset.season.calendar;

function run(state: LeagueState, command: Parameters<typeof handleCommand>[1]): LeagueEvent[] {
  const res = handleCommand(state, command, local, ctx);
  if (!res.ok) throw new Error(res.error.message);
  return res.events;
}

/** Plays out the season, the playoffs and the offseason. Returns the champion and all events. */
function playSeasonAndRollOver(state: LeagueState) {
  const events = run(state, {
    kind: 'sim.advance',
    days: calendar.regularSeasonDays + calendar.playoffDays,
  });
  const champion = state.championTeamId;
  events.push(...run(state, { kind: 'season.rollover' }));
  return { champion, events };
}

function checkLeagueIsLegal(state: LeagueState) {
  expect(playoffCapBreaches(Object.values(state.players), ruleset)).toEqual([]);
  for (const id of Object.keys(state.teams) as TeamId[]) {
    const roster = Object.values(state.players).filter((p) => p.teamId === id);
    const payroll = roster.reduce((s, p) => s + (p.contract?.capHit ?? 0), 0);
    expect(payroll).toBeLessThanOrEqual(ruleset.cap.upperLimit);
    expect(roster.length).toBeGreaterThanOrEqual(ruleset.roster.minActive);
    for (const [position, min] of Object.entries(ruleset.roster.positionMin)) {
      expect(roster.filter((p) => p.position === position).length).toBeGreaterThanOrEqual(min);
    }
    for (const p of roster) {
      expect(p.contract).toBeDefined();
      expect(
        validateContract(ruleset, {
          salaries: [p.contract!.capHit],
          signingAge: state.date.season - p.birthYear,
          isResign: false,
        }),
      ).toEqual([]);
    }
  }
}

describe('offseason rollover', () => {
  it('refuses to roll over before a champion is crowned', () => {
    const state = createLeague(1, ctx);
    expect(handleCommand(state, { kind: 'season.rollover' }, local, ctx).ok).toBe(false);
  });

  it('starts the next season with a fresh schedule and a clean slate', () => {
    const state = createLeague(2, ctx);
    const startSeason = state.date.season;
    const { events } = playSeasonAndRollOver(state);
    expect(state.date).toEqual({ season: startSeason + 1, day: 0 });
    expect(state.championTeamId).toBeNull();
    expect(Object.keys(state.results)).toHaveLength(0);
    expect(Object.keys(state.playoffSeries)).toHaveLength(0);
    expect(state.schedule.every((g) => g.date.season === startSeason + 1)).toBe(true);
    expect(events.at(-1)?.kind).toBe('season.phaseChanged');
    // The new season can be played straight away.
    run(state, { kind: 'sim.advance', days: 10 });
    expect(Object.keys(state.results).length).toBeGreaterThan(0);
  });

  it('plays 20 seasons: no crash, rosters legal every year, replay ends identical', () => {
    const live = createLeague(31, ctx);
    const replica: LeagueState = structuredClone(live);
    const titles = new Map<string, number>();
    for (let year = 0; year < 20; year++) {
      const { champion, events } = playSeasonAndRollOver(live);
      for (const e of events) applyEvent(replica, e);
      titles.set(champion!, (titles.get(champion!) ?? 0) + 1);
      checkLeagueIsLegal(live);
    }
    expect(live.date.season).toBe(2027 + 20);
    expect(replica).toEqual(live);
    // A single league's top title count is noisy (3-9 seen over 100 leagues); this only catches a runaway.
    expect(Math.max(...titles.values())).toBeLessThanOrEqual(9);
    // Retired players leave the league and the free-agent pool stays small.
    const pool = Object.values(live.players).filter((p) => p.teamId === null);
    expect(pool.length).toBeLessThan(150);
    expect(Object.values(live.players).every((p) => live.date.season - p.birthYear < 43)).toBe(
      true,
    );
  }, 60_000);

  it('is deterministic: the same seed gives the same 3 seasons', () => {
    const a = createLeague(5, ctx);
    const b = createLeague(5, ctx);
    for (let i = 0; i < 3; i++) {
      expect(playSeasonAndRollOver(a).events).toEqual(playSeasonAndRollOver(b).events);
    }
  }, 30_000); // six seasons with the shift-by-shift game: ~2 s here, over 5 s on a slow CI runner
});

describe('awards', () => {
  it('gives the champion and five player awards once the season ends, and replays identically', () => {
    const live = createLeague(41, ctx);
    const replica: LeagueState = structuredClone(live);
    const events = run(live, {
      kind: 'sim.advance',
      days: calendar.regularSeasonDays + calendar.playoffDays,
    });
    events.forEach((e) => applyEvent(replica, e));
    expect(replica).toEqual(live);
    const given = events.flatMap((e) => (e.kind === 'award.given' ? [e] : []));
    expect(given.map((e) => e.award)).toEqual([
      'champion',
      'mvp',
      'topGoalie',
      'topDefender',
      'topRookie',
      'playoffMvp',
    ]);
    expect(given[0]!.teamId).toBe(live.championTeamId);
    const byAward = Object.fromEntries(given.map((e) => [e.award, live.players[e.playerId ?? '']]));
    // The MVP leads the league in points; the goalie award goes to a qualified goalie.
    const { skaters } = hockeySeasonStats(
      Object.values(live.results).filter((g) => !g.playoffSeriesId),
    );
    const points = (id: string) => (skaters.get(id)?.goals ?? 0) + (skaters.get(id)?.assists ?? 0);
    expect(points(byAward.mvp!.id)).toBe(Math.max(...[...skaters.keys()].map(points)));
    expect(byAward.topGoalie!.position).toBe('G');
    expect(byAward.topDefender!.position).toBe('D');
    expect(live.date.season - byAward.topRookie!.birthYear).toBeLessThanOrEqual(
      ruleset.awards.rookieMaxAge,
    );
    // Playoff MVP: a champion, the best by goals (skater) or goals saved above average (goalie).
    expect(byAward.playoffMvp!.teamId).toBe(live.championTeamId);
    expect(events.some((e) => e.kind === 'news.posted' && e.headline === 'event.awardWon')).toBe(
      true,
    );
  });
});

describe('offseason steps', () => {
  it('free agents that nobody can use never block a team from filling its roster', () => {
    const state = createLeague(8, ctx);
    // Empty one team's roster completely: it must be rebuilt from the pool and rookies.
    const victim = Object.keys(state.teams)[3] as TeamId;
    for (const p of Object.values(state.players)) {
      if (p.teamId === victim) {
        p.teamId = null;
        delete p.contract;
      }
    }
    playSeasonAndRollOver(state);
    checkLeagueIsLegal(state);
  });

  it('a lottery team drafts first and drafted players get entry-level contracts', () => {
    const state = createLeague(9, ctx);
    run(state, { kind: 'sim.advance', days: calendar.regularSeasonDays + calendar.playoffDays });
    const standings = computeStandings(
      Object.keys(state.teams) as TeamId[],
      Object.values(state.results),
      ruleset.season.points,
    );
    // The lottery pool: every team that missed the playoffs, up to the number of odds.
    const pool = standings
      .slice(ruleset.playoffs.teamsQualifying)
      .map((r) => r.teamId)
      .slice(-ruleset.draft.lottery!.odds.length);
    const picks = run(state, { kind: 'season.rollover' }).filter(
      (e) => e.kind === 'player.drafted' && e.round > 0,
    );
    expect(picks).toHaveLength(Object.keys(state.teams).length * ruleset.draft.rounds);
    const first = picks[0]!;
    if (first.kind !== 'player.drafted') throw new Error();
    expect(first.pick).toBe(1);
    expect(pool).toContain(first.teamIds[0]);
    expect(first.player.contract?.capHit).toBe(ruleset.contracts.elcSalary);
    expect(elcYears(ruleset, state.date.season - first.player.birthYear)).toBe(
      first.player.contract!.expiresAfterSeason - state.date.season + 1,
    );
  });

  it('players age, develop and retire: nobody ends up older than the retirement age', () => {
    const state = createLeague(12, ctx);
    const before = structuredClone(state.players);
    const events = playSeasonAndRollOver(state).events;
    expect(events.some((e) => e.kind === 'players.developed')).toBe(true);
    const retired = events.filter((e) => e.kind === 'player.retired');
    expect(retired.length).toBeGreaterThan(0);
    for (const e of retired) {
      if (e.kind === 'player.retired') expect(state.players[e.playerId]).toBeUndefined();
    }
    // Some young player improved.
    const improved = Object.values(state.players).filter(
      (p) =>
        before[p.id] &&
        state.date.season - p.birthYear <= 22 &&
        Object.values(p.ratings).reduce((a, b) => a + b, 0) >
          Object.values(before[p.id]!.ratings).reduce((a, b) => a + b, 0),
    );
    expect(improved.length).toBeGreaterThan(0);
  });
});

describe('playoff cap', () => {
  it('flags a team whose best 18 skaters and 2 goalies cost more than the cap', () => {
    const state = createLeague(3, ctx);
    const players = Object.values(state.players);
    expect(playoffCapBreaches(players, ruleset)).toEqual([]);
    const victim = players.find((p) => p.teamId === 't0' && p.position !== 'G')!;
    victim.contract = { ...victim.contract!, capHit: ruleset.cap.upperLimit + 1 };
    expect(playoffCapBreaches(players, ruleset)).toEqual(['t0']);
    expect(
      playoffCapBreaches(players, { ...ruleset, cap: { ...ruleset.cap, playoffCap: null } }),
    ).toEqual([]);
  });
});

describe('records', () => {
  it('picks the best team seasons and the most titles', () => {
    const row = (teamId: string, pts: number, w: number, gf: number, ga: number) =>
      ({ teamId, gp: 84, w, l: 0, otl: 0, pts, gf, ga }) as never;
    const records = teamRecords(
      [
        { season: 2027, rows: [row('a', 100, 45, 250, 200), row('b', 90, 40, 260, 180)] },
        { season: 2028, rows: [row('a', 100, 50, 240, 180), row('b', 80, 35, 200, 210)] },
      ],
      ['a', 'b', 'a'] as never,
    );
    const by = Object.fromEntries(records.map((r) => [r.key, r]));
    expect(by.points).toMatchObject({ teamId: 'a', season: 2027, value: 100 }); // tie: earliest
    expect(by.wins).toMatchObject({ teamId: 'a', season: 2028, value: 50 });
    expect(by.goalsFor).toMatchObject({ teamId: 'b', season: 2027, value: 260 });
    expect(by.goalsAgainst).toMatchObject({ teamId: 'b', season: 2027, value: 180 }); // tie: earliest
    expect(by.titles).toMatchObject({ teamId: 'a', value: 2 });
  });
});

describe('player records', () => {
  it('keeps the best season per stat, earliest on a tie', () => {
    const board = (key: string, name: string, value: number) =>
      ({ key, rows: [{ playerId: name, name, teamId: null, gp: 80, value }] }) as never;
    const by = Object.fromEntries(
      playerRecords([
        { season: 2028, boards: [board('goals', 'B', 50), board('savePct', 'B', 0.92)] },
        { season: 2027, boards: [board('goals', 'A', 50), board('savePct', 'A', 0.91)] },
      ]).map((r) => [r.key, r]),
    );
    expect(by.playerGoals).toMatchObject({ playerName: 'A', season: 2027, value: 50 });
    expect(by.playerSavePct).toMatchObject({ playerName: 'B', season: 2028 });
  });
});

describe('draft lottery', () => {
  const rule = ruleset.draft.lottery!;
  const order = Array.from({ length: 16 }, (_, i) => `t${i}` as TeamId); // worst first

  it('moves at most `draws` teams up, nobody falls more than that, and keeps everyone', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const result = lotteryOrder(order, rule, 16, new Rng(seed));
      expect([...result].sort()).toEqual([...order].sort());
      result.forEach((id, i) => expect(i - order.indexOf(id)).toBeLessThanOrEqual(rule.draws));
    }
    expect(lotteryOrder(order, null, 16, new Rng(1))).toEqual(order);
  });

  it('gives the worst team its listed chance, and playoff teams never move', () => {
    let worstFirst = 0;
    const trials = 4000;
    for (let seed = 1; seed <= trials; seed++) {
      const result = lotteryOrder(order, rule, 8, new Rng(seed));
      if (result[0] === order[0]) worstFirst++;
      expect(result.slice(8)).toEqual(order.slice(8));
    }
    // 8 teams in the lottery: the worst has 18.5 of the first eight teams' 77 points.
    const expected = 18.5 / rule.odds.slice(0, 8).reduce((a, b) => a + b, 0);
    expect(Math.abs(worstFirst / trials - expected)).toBeLessThan(0.03);
  });
});
