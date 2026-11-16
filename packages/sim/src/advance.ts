import type { GameId, GameResult, LeagueEvent, Player, TeamId } from '@gm/shared';
import {
  applyEvent,
  emitter,
  makeEvent,
  phaseOf,
  Rng,
  type LeagueState,
  type ScheduledGame,
} from './core';
import { classifyTeams, computeStandings, nextRound, seedPlayoffs } from './league';
import { giveSeasonAwards } from './awards';
import { announceDraftClass } from './offseason';
import { aiTrades } from './trades';
import type { SimContext } from './context';

/**
 * The day loop behind `sim.advance`: each day plays its games (and playoff games), records
 * injuries, highlights and streaks, moves the playoffs on, crowns the champion and announces the
 * draft class, refreshes the league pulse weekly (with AI trade talks), and changes phase. Every
 * change is an event applied as it is made. Stops early on what matters to a human team when
 * `stopOn` is 'major'.
 */
export function advance(
  state: LeagueState,
  days: number,
  stopOn: 'never' | 'major',
  ctx: SimContext,
): LeagueEvent[] {
  const events: LeagueEvent[] = [];
  const emit = (e: LeagueEvent) => {
    applyEvent(state, e);
    events.push(e);
  };
  const rng = new Rng(state.rngState);
  const cal = ctx.ruleset.season.calendar;

  // Rosters once per call; a team's strength is rebuilt only when its set of injured players changes.
  const sport = ctx.sport;
  const rosters = new Map<TeamId, Player[]>();
  const strengths = new Map<TeamId, { out: string; strength: unknown }>();
  /** Rebuilt at the start and after a trade moves players. */
  const loadRosters = () => {
    rosters.clear();
    strengths.clear();
    for (const p of Object.values(state.players)) {
      if (p.teamId) rosters.set(p.teamId, [...(rosters.get(p.teamId) ?? []), p]);
    }
  };
  loadRosters();
  const strengthOf = (team: TeamId, day: number) => {
    const roster = rosters.get(team) ?? [];
    const hurt = roster.filter((p) => (p.injuredUntil ?? 0) > day);
    const out = hurt.map((p) => p.id).join();
    let cached = strengths.get(team);
    if (!cached || cached.out !== out) {
      const healthy = hurt.length ? roster.filter((p) => !hurt.includes(p)) : roster;
      cached = { out, strength: sport.teamStrength(healthy, state.depthCharts[team]) };
      strengths.set(team, cached);
    }
    return cached.strength;
  };
  // Each team's current run (wins > 0, losses < 0), from this season's games so far.
  const streaks = new Map<TeamId, number>();
  for (const g of Object.values(state.results)) {
    if (g.playoffSeriesId) continue;
    const homeWon = g.homeScore > g.awayScore;
    for (const [id, won] of [
      [g.homeTeamId, homeWon],
      [g.awayTeamId, !homeWon],
    ] as const) {
      const run = streaks.get(id) ?? 0;
      streaks.set(id, won ? Math.max(0, run) + 1 : Math.min(0, run) - 1);
    }
  }
  /** Records a finished game and the injuries it caused (the injuries are not kept on the result). */
  const finishGame = (result: GameResult, day: number) => {
    const { injuries = [], ...game } = result;
    emit(
      makeEvent(state, 'minor', [game.homeTeamId, game.awayTeamId], {
        kind: 'game.final',
        result: game,
      }),
    );
    const team = (id: TeamId) => `${state.teams[id]!.city} ${state.teams[id]!.name}`;
    for (const h of sport.highlights(game)) {
      const p = state.players[h.playerId];
      if (!p) continue;
      // Yours make the feed; the league's (a few a week) stay in the log.
      const importance = state.teams[h.teamId]?.userControlled ? 'notable' : 'minor';
      emit(
        makeEvent(state, importance, [h.teamId], {
          kind: 'news.posted',
          headline: `event.${h.key}`,
          params: { player: `${p.firstName} ${p.lastName}`, team: team(h.teamId) },
        }),
      );
    }
    // Streaks: news when a run reaches a milestone (regular season only).
    if (!game.playoffSeriesId) {
      const homeWon = game.homeScore > game.awayScore;
      for (const [id, won] of [
        [game.homeTeamId, homeWon],
        [game.awayTeamId, !homeWon],
      ] as const) {
        const run = streaks.get(id) ?? 0;
        const next = won ? Math.max(0, run) + 1 : Math.min(0, run) - 1;
        streaks.set(id, next);
        if (STREAK_MILESTONES.includes(Math.abs(next))) {
          emit(
            makeEvent(state, 'notable', [id], {
              kind: 'news.posted',
              headline: next > 0 ? 'event.winStreak' : 'event.losingStreak',
              params: { team: team(id), n: Math.abs(next) },
            }),
          );
        }
      }
    }
    for (const { playerId, days } of injuries) {
      const teamId = state.players[playerId]?.teamId;
      emit(
        makeEvent(state, 'notable', teamId ? [teamId] : [], {
          kind: 'player.injured',
          playerId,
          days,
          until: day + 1 + days,
        }),
      );
    }
  };
  // Who plays on which day, so the second night of a back-to-back is known.
  const playing = new Map<number, Set<TeamId>>();
  for (const g of state.schedule) {
    if (g.date.season !== state.date.season) continue;
    const day = playing.get(g.date.day) ?? new Set<TeamId>();
    playing.set(g.date.day, day.add(g.homeTeamId).add(g.awayTeamId));
  }
  const backToBack = (team: TeamId, day: number) => playing.get(day - 1)?.has(team) ?? false;
  const byDay = new Map<number, ScheduledGame[]>();
  for (const g of state.schedule) {
    if (g.date.season !== state.date.season || state.results[g.id]) continue;
    const list = byDay.get(g.date.day) ?? [];
    list.push(g);
    byDay.set(g.date.day, list);
  }

  for (let d = 0; d < days; d++) {
    const today = { ...state.date };
    const dayStart = events.length;

    for (const g of byDay.get(today.day) ?? []) {
      const result = sport.simGame(
        {
          id: g.id as GameId,
          homeTeamId: g.homeTeamId,
          awayTeamId: g.awayTeamId,
          home: strengthOf(g.homeTeamId, today.day),
          away: strengthOf(g.awayTeamId, today.day),
          homeBackToBack: backToBack(g.homeTeamId, today.day),
          awayBackToBack: backToBack(g.awayTeamId, today.day),
        },
        rng,
      );
      finishGame(result, today.day);
    }

    if (phaseOf(cal, today) === 'playoffs' && !state.championTeamId) {
      const allSeries = Object.values(state.playoffSeries);
      const round = Math.max(0, ...allSeries.map((s) => s.round));
      const active = allSeries.filter((s) => s.round === round && !s.winnerTeamId);
      const winsNeeded = Math.floor(ctx.ruleset.playoffs.seriesLength / 2) + 1;
      for (const series of active) {
        const gameIndex = series.higherWins + series.lowerWins;
        const lowerHome = ctx.ruleset.playoffs.homeIcePattern[gameIndex] === 1;
        const homeTeamId = lowerHome ? series.lowerTeamId : series.higherTeamId;
        const awayTeamId = lowerHome ? series.higherTeamId : series.lowerTeamId;
        const result = sport.simGame(
          {
            id: `p${today.season}_${series.id}_${gameIndex + 1}` as GameId,
            homeTeamId,
            awayTeamId,
            home: strengthOf(homeTeamId, today.day),
            away: strengthOf(awayTeamId, today.day),
            playoff: true,
          },
          rng,
        );
        result.playoffSeriesId = series.id;
        finishGame(result, today.day);
        if (series.higherWins === winsNeeded || series.lowerWins === winsNeeded) {
          const winnerTeamId =
            series.higherWins === winsNeeded ? series.higherTeamId : series.lowerTeamId;
          emit(
            makeEvent(state, 'major', [series.higherTeamId, series.lowerTeamId], {
              kind: 'series.won',
              seriesId: series.id,
              winnerTeamId,
            }),
          );
          const winner = state.teams[winnerTeamId]!;
          emit(
            makeEvent(state, 'notable', [winnerTeamId], {
              kind: 'news.posted',
              headline: 'event.seriesWon',
              params: { team: `${winner.city} ${winner.name}`, round: series.round },
            }),
          );
        }
      }
      const current = Object.values(state.playoffSeries).filter((s) => s.round === round);
      if (current.length && current.every((s) => s.winnerTeamId)) {
        if (current.length === 1) {
          const championTeamId = current[0]!.winnerTeamId!;
          emit(
            makeEvent(state, 'major', [championTeamId], {
              kind: 'champion.crowned',
              championTeamId,
            }),
          );
          const champion = state.teams[championTeamId]!;
          emit(
            makeEvent(state, 'major', [championTeamId], {
              kind: 'news.posted',
              headline: 'event.championCrowned',
              params: { team: `${champion.city} ${champion.name}` },
            }),
          );
          giveSeasonAwards(state, ctx, emitter(state, events));
          announceDraftClass(state, ctx, rng.fork('draftClass'), emitter(state, events));
        } else {
          for (const series of nextRound(current)) {
            emit(
              makeEvent(state, 'notable', [series.higherTeamId, series.lowerTeamId], {
                kind: 'series.started',
                series,
              }),
            );
          }
        }
      }
    }

    // League pulse once a week.
    if (phaseOf(cal, today) === 'regular' && today.day % 7 === 6) {
      const rows = computeStandings(
        Object.keys(state.teams) as TeamId[],
        Object.values(state.results),
        ctx.ruleset.season.points,
      );
      const next = classifyTeams(rows);
      for (const [teamId, to] of Object.entries(next) as [TeamId, (typeof next)[TeamId]][]) {
        const from = state.teamStatus[teamId];
        if (from && from !== to) {
          emit(
            makeEvent(state, 'notable', [teamId], { kind: 'team.statusChanged', teamId, from, to }),
          );
        }
      }
      // Forked, so trade talks never shift the games' random numbers.
      const before = events.length;
      aiTrades(state, ctx, rng.fork(`trades${today.day}`), emitter(state, events));
      if (events.length > before) loadRosters();
    }

    const tomorrow = { season: today.season, day: today.day + 1 };
    const fromPhase = phaseOf(cal, today);
    const toPhase = phaseOf(cal, tomorrow);
    if (fromPhase !== toPhase) {
      emit(
        makeEvent(state, 'major', [], {
          kind: 'season.phaseChanged',
          from: fromPhase,
          to: toPhase,
        }),
      );
      if (toPhase === 'playoffs') {
        const rows = computeStandings(
          Object.keys(state.teams) as TeamId[],
          Object.values(state.results),
          ctx.ruleset.season.points,
        );
        for (const series of seedPlayoffs(
          rows,
          ctx.ruleset,
          today.season,
          Object.values(state.teams),
        )) {
          emit(
            makeEvent(state, 'notable', [series.higherTeamId, series.lowerTeamId], {
              kind: 'series.started',
              series,
            }),
          );
        }
      }
    }

    emit(
      makeEvent(state, 'minor', [], {
        kind: 'clock.advanced',
        to: tomorrow,
        rngState: rng.state,
      }),
    );

    if (stopOn === 'major' && events.slice(dayStart).some((e) => matters(state, e))) break;
  }
  return events;
}

/** Win or losing streaks of these lengths make the news. */
const STREAK_MILESTONES = [6, 9, 12];

/** Injuries at least this long to one of your players stop "sim until it matters". */
const LONG_INJURY_DAYS = 14;

/**
 * Whether an event should stop "sim until it matters": a major league-wide moment (phase change,
 * champion), a major event for a human team (its series, its trade), or a long injury to one of
 * its players. Other teams' trades and series don't.
 */
function matters(state: LeagueState, e: LeagueEvent): boolean {
  const yours = e.teamIds.some((id) => state.teams[id]?.userControlled);
  if (e.importance === 'major') return e.teamIds.length === 0 || yours;
  return e.kind === 'player.injured' && yours && e.days >= LONG_INJURY_DAYS;
}
