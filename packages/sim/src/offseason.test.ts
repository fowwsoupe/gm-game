import { describe, expect, it } from 'vitest';
import type { Actor, LeagueEvent, TeamId } from '@gm/shared';
import {
  applyEvent,
  computeStandings,
  createLeague,
  defaultContext,
  elcYears,
  handleCommand,
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
    expect(Math.max(...titles.values())).toBeLessThanOrEqual(7);
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
  });
});

describe('awards', () => {
  it('gives the champion and four player awards once the season ends, and replays identically', () => {
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
    ]);
    expect(given[0]!.teamId).toBe(live.championTeamId);
    const byAward = Object.fromEntries(given.map((e) => [e.award, live.players[e.playerId ?? '']]));
    expect(byAward.topGoalie!.position).toBe('G');
    expect(byAward.topDefender!.position).toBe('D');
    expect(live.date.season - byAward.topRookie!.birthYear).toBeLessThanOrEqual(
      ruleset.awards.rookieMaxAge,
    );
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

  it('worst team drafts first and drafted players get entry-level contracts', () => {
    const state = createLeague(9, ctx);
    run(state, { kind: 'sim.advance', days: calendar.regularSeasonDays + calendar.playoffDays });
    const standings = computeStandings(
      Object.keys(state.teams) as TeamId[],
      Object.values(state.results),
      ruleset.season.points,
    );
    const worst = standings.at(-1)!.teamId;
    const picks = run(state, { kind: 'season.rollover' }).filter(
      (e) => e.kind === 'player.drafted' && e.round > 0,
    );
    expect(picks).toHaveLength(Object.keys(state.teams).length * ruleset.draft.rounds);
    const first = picks[0]!;
    if (first.kind !== 'player.drafted') throw new Error();
    expect(first.pick).toBe(1);
    expect(first.teamIds).toEqual([worst]);
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
