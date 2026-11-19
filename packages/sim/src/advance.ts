import type {
  GameId,
  GameResult,
  LeagueEvent,
  Player,
  PlayerId,
  PlayoffSeries,
  StopCategory,
  TeamId,
} from '@gm/shared';
import { STOP_CATEGORIES } from '@gm/shared';
import {
  emitter,
  pairKey,
  phaseOf,
  playerName,
  Rng,
  teamName,
  type LeagueState,
  type ScheduledGame,
} from './core';
import {
  classifyTeams,
  leagueStandings,
  nextRound,
  playoffOdds,
  seedPlayoffs,
  worstFirst,
  type PulseInput,
} from './league';
import { giveSeasonAwards } from './awards';
import { aiHoldouts, announceDraftClass, prospectSeason } from './offseason';
import { aiOffers, aiTrades, deadlineRecap, inDeadlineWeek } from './trades';
import {
  campReport,
  disputesWeek,
  holdoutsWeek,
  staffOf,
  startHoldouts,
  tradeRequests,
} from './people';
import { sitsOut, strengthFor } from './tonight';
import { aiFarmMoves } from './farm';
import { byOverall, overall } from './players';
import { payBonuses, payroll } from './cba';
import { settleMonth, settlePlayoffs, settlesOn } from './finance';
import {
  aiGmFired,
  checksInOn,
  coachWeek,
  deadlineCheckIn,
  ownerMonth,
  pressQuestion,
  preseasonMeeting,
  seasonReview,
} from './owner';
import type { SimContext } from './context';

/**
 * The day loop behind `sim.advance`: each day plays its games (and playoff games), records
 * injuries, highlights and streaks, moves the playoffs on, crowns the champion and announces the
 * draft class, refreshes the league pulse weekly (with AI trade talks, daily in deadline week),
 * and changes phase. Every change is an event applied as it is made. Stops early on what matters
 * to a human team when `stopOn` is 'major'.
 */
export function advance(
  state: LeagueState,
  days: number,
  stopOn: 'never' | 'major' | readonly StopCategory[],
  ctx: SimContext,
): LeagueEvent[] {
  const events: LeagueEvent[] = [];
  const emit = emitter(state, events);
  // A series starts; a rematch of last season's playoffs is a rivalry renewed (news only).
  const startSeries = (series: PlayoffSeries) => {
    const { higherTeamId: a, lowerTeamId: b } = series;
    const renewed = state.playoffPairs[pairKey(a, b)] === state.date.season - 1;
    emit('notable', [a, b], { kind: 'series.started', series });
    if (renewed) {
      emit('notable', [a, b], {
        kind: 'news.posted',
        headline: 'event.rivalry',
        params: { a: teamName(state.teams[a]!), b: teamName(state.teams[b]!) },
      });
    }
  };
  const rng = new Rng(state.rngState);
  const stops = new Set<StopCategory>(
    stopOn === 'major' ? STOP_CATEGORIES : stopOn === 'never' ? [] : stopOn,
  );
  const cal = ctx.ruleset.season.calendar;
  // Medical staff: injury days x (1 + medical.days x (league average - quality)). Staff only
  // change in the summer, so once per call is enough.
  const fo = ctx.ruleset.frontOffice;
  const medical = new Map(
    Object.values(state.teams).map((t) => [
      t.id,
      staffOf(t, 'medical', fo.salary, state.date.season).quality,
    ]),
  );
  const avgMedical = [...medical.values()].reduce((a, b) => a + b, 0) / Math.max(1, medical.size);
  /** A team's injury factor: below 1 for a better-than-average medical head. */
  const medicalFactor = (teamId: TeamId | null | undefined) =>
    1 + fo.medical.days * (avgMedical - (medical.get(teamId!) ?? avgMedical));
  const healed = (teamId: TeamId | null | undefined, days: number) =>
    Math.max(1, Math.round(days * medicalFactor(teamId)));

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
    const hurt = roster.filter((p) => sitsOut(state, p, day));
    const out = hurt.map((p) => p.id).join();
    let cached = strengths.get(team);
    if (!cached || cached.out !== out) {
      const healthy = hurt.length ? roster.filter((p) => !hurt.includes(p)) : roster;
      cached = { out, strength: strengthFor(state, ctx, team, healthy) };
      strengths.set(team, cached);
    }
    return cached.strength;
  };
  // Each team's current run (wins > 0, losses < 0), from this season's games so far.
  const streaks = new Map<TeamId, number>();
  /** Adds a result to a team's run and returns the new run. */
  const bump = (id: TeamId, won: boolean) => {
    const run = streaks.get(id) ?? 0;
    const next = won ? Math.max(0, run) + 1 : Math.min(0, run) - 1;
    streaks.set(id, next);
    return next;
  };
  for (const g of Object.values(state.results)) {
    if (g.playoffSeriesId) continue;
    const homeWon = g.homeScore > g.awayScore;
    bump(g.homeTeamId, homeWon);
    bump(g.awayTeamId, !homeWon);
  }
  // Games in a row each skater has played without a point (a goalie has no points, so never here).
  const droughts = new Map<string, number>();
  const trackDroughts = (game: GameResult) => {
    for (const [id, line] of sport.playerLines([game])) {
      if (line.points === undefined || !line.gp) continue;
      droughts.set(id, line.points > 0 ? 0 : (droughts.get(id) ?? 0) + 1);
    }
  };
  for (const g of Object.values(state.results)) if (!g.playoffSeriesId) trackDroughts(g);
  // This season's games and points so far, for the in-season breakout check.
  const seasonLines = new Map<string, { gp: number; points: number }>();
  const trackSeason = (game: GameResult) => {
    const played: string[] = [];
    for (const [id, line] of sport.playerLines([game])) {
      if (line.points === undefined || !line.gp) continue;
      const s = seasonLines.get(id) ?? { gp: 0, points: 0 };
      seasonLines.set(id, { gp: s.gp + line.gp, points: s.points + line.points });
      played.push(id);
    }
    return played;
  };
  for (const g of Object.values(state.results)) if (!g.playoffSeriesId) trackSeason(g);
  /** Records a finished game and the injuries it caused (the injuries are not kept on the result). */
  const finishGame = (result: GameResult, day: number) => {
    const { injuries = [], ...game } = result;
    // Time together (linemates) grew: both teams' strength is rebuilt before their next game, so
    // it never depends on how many days one call sims.
    strengths.delete(game.homeTeamId);
    strengths.delete(game.awayTeamId);
    emit('minor', [game.homeTeamId, game.awayTeamId], { kind: 'game.final', result: game });
    for (const h of sport.highlights(game)) {
      const p = state.players[h.playerId];
      if (!p) continue;
      // Yours make the feed; the league's (a few a week) stay in the log.
      const importance = state.teams[h.teamId]?.userControlled ? 'notable' : 'minor';
      emit(importance, [h.teamId], {
        kind: 'news.posted',
        headline: `event.${h.key}`,
        playerId: p.id,
        params: { player: playerName(p), team: teamName(state.teams[h.teamId]!) },
      });
    }
    // Streaks and slumps: news when a run reaches a milestone (regular season only).
    if (!game.playoffSeriesId) {
      trackDroughts(game);
      // Young skater on a pace well above last season's, checked once, at his 20th game (news only).
      for (const id of trackSeason(game)) {
        const s = seasonLines.get(id)!;
        const p = state.players[id];
        const last = state.lastSeason[id as PlayerId];
        const team = p?.teamId ? state.teams[p.teamId] : undefined;
        if (s.gp !== BREAKOUT_GAMES || !p || !team || !last) continue;
        if (state.date.season - p.birthYear > BREAKOUT_AGE) continue;
        if (last.points < BREAKOUT_MIN_POINTS || last.gp < BREAKOUT_MIN_GAMES) continue;
        if (s.points / s.gp < (last.points / last.gp) * BREAKOUT_PACE) continue;
        emit(team.userControlled ? 'notable' : 'minor', [team.id], {
          kind: 'news.posted',
          headline: 'event.breakoutPace',
          playerId: p.id,
          params: { player: playerName(p), team: teamName(team), n: s.points, gp: s.gp },
        });
        if (team.userControlled) {
          emit('minor', [team.id], {
            kind: 'player.brokeOut',
            playerId: p.id,
            teamId: team.id,
            season: state.date.season,
          });
        }
      }
      for (const teamId of [game.homeTeamId, game.awayTeamId]) {
        const stars = Object.values(state.players)
          .filter((p) => p.teamId === teamId && droughts.has(p.id))
          .sort(byOverall)
          .slice(0, SLUMP_STARS);
        for (const p of stars) {
          if (droughts.get(p.id) !== SLUMP_GAMES) continue;
          emit(state.teams[teamId]!.userControlled ? 'notable' : 'minor', [teamId], {
            kind: 'news.posted',
            headline: 'event.slump',
            playerId: p.id,
            params: { player: playerName(p), team: teamName(state.teams[teamId]!), n: SLUMP_GAMES },
          });
        }
      }
      const homeWon = game.homeScore > game.awayScore;
      for (const [id, won] of [
        [game.homeTeamId, homeWon],
        [game.awayTeamId, !homeWon],
      ] as const) {
        const next = bump(id, won);
        if (STREAK_MILESTONES.includes(Math.abs(next))) {
          emit('notable', [id], {
            kind: 'news.posted',
            headline: next > 0 ? 'event.winStreak' : 'event.losingStreak',
            params: { team: teamName(state.teams[id]!), n: Math.abs(next) },
          });
          pressQuestion(state, emit, id, next > 0 ? 'pressWin' : 'pressLoss', Math.abs(next));
        }
      }
    }
    for (const injury of injuries) {
      const { playerId } = injury;
      const teamId = state.players[playerId]?.teamId;
      const days = healed(teamId, injury.days);
      emit('notable', teamId ? [teamId] : [], {
        kind: 'player.injured',
        playerId,
        days,
        until: day + 1 + days,
      });
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
  // Who starts in goal: the team's rotation setting decides (AI teams: the backup on back-to-backs).
  const rest = (team: TeamId, day: number) => {
    const b2b = backToBack(team, day);
    const rotation = state.goalieRotation[team] ?? 'backToBack';
    return {
      backup: rotation === 'always' ? false : b2b || (rotation === 'split' && day % 4 === 3),
      tired: rotation === 'always' && b2b,
    };
  };
  const byDay = new Map<number, ScheduledGame[]>();
  for (const g of state.schedule) {
    if (g.date.season !== state.date.season || state.results[g.id]) continue;
    const list = byDay.get(g.date.day) ?? [];
    list.push(g);
    byDay.set(g.date.day, list);
  }

  for (let d = 0; d < days; d++) {
    const today = { ...state.date };
    // Camp opens (an old save's season opened on day 0): a player who feels underpaid may refuse
    // to report, and the owner meets his GM, before day 0 settles, so the season's profit counts
    // its bonuses.
    if (today.day <= 0 && !Object.values(state.owners).some((o) => o.season === today.season)) {
      startHoldouts(state, ctx, rng.fork('holdouts'), emit);
      preseasonMeeting(state, ctx, emit);
    }
    // Camp's last day: the head coach's read of the team.
    if (today.day === -1) campReport(state, ctx, rng.fork('camp'), emit);
    if (settlesOn(today.day, cal.regularSeasonDays)) {
      settleMonth(state, ctx, emit, today.day);
      if (today.day > 0) ownerMonth(state, ctx, emit);
    }
    if (checksInOn(today.day, ctx)) deadlineCheckIn(state, ctx, emit);
    // From opening night on, AI teams cut to the roster limit and call up for injuries.
    if (today.day >= 0 && !state.championTeamId) {
      aiFarmMoves(state, ctx, emit, today.day);
    }
    const dayStart = events.length;

    for (const g of byDay.get(today.day) ?? []) {
      const homeRest = rest(g.homeTeamId, today.day);
      const awayRest = rest(g.awayTeamId, today.day);
      const result = sport.simGame(
        {
          id: g.id as GameId,
          homeTeamId: g.homeTeamId,
          awayTeamId: g.awayTeamId,
          home: strengthOf(g.homeTeamId, today.day),
          away: strengthOf(g.awayTeamId, today.day),
          homeBackToBack: homeRest.backup,
          awayBackToBack: awayRest.backup,
          homeTired: homeRest.tired,
          awayTired: awayRest.tired,
          homeMedical: medicalFactor(g.homeTeamId),
          awayMedical: medicalFactor(g.awayTeamId),
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
            homeMedical: medicalFactor(homeTeamId),
            awayMedical: medicalFactor(awayTeamId),
          },
          rng,
        );
        result.playoffSeriesId = series.id;
        finishGame(result, today.day);
        if (series.higherWins === winsNeeded || series.lowerWins === winsNeeded) {
          const winnerTeamId =
            series.higherWins === winsNeeded ? series.higherTeamId : series.lowerTeamId;
          emit('major', [series.higherTeamId, series.lowerTeamId], {
            kind: 'series.won',
            seriesId: series.id,
            winnerTeamId,
          });
          const winner = state.teams[winnerTeamId]!;
          emit('notable', [winnerTeamId], {
            kind: 'news.posted',
            headline: 'event.seriesWon',
            params: { team: teamName(winner), round: series.round },
          });
          const loserTeamId =
            winnerTeamId === series.higherTeamId ? series.lowerTeamId : series.higherTeamId;
          pressQuestion(state, emit, winnerTeamId, 'pressSeries', series.round);
          pressQuestion(state, emit, loserTeamId, 'pressOut', series.round);
        }
      }
      const current = Object.values(state.playoffSeries).filter((s) => s.round === round);
      if (current.length && current.every((s) => s.winnerTeamId)) {
        if (current.length === 1) {
          const championTeamId = current[0]!.winnerTeamId!;
          // Still this season's cap year: bonuses over the cap go to next season's.
          const paid = payBonuses(state, ctx, emit);
          settlePlayoffs(state, ctx, emit, paid);
          seasonReview(state, ctx, emit, rng.fork('review'));
          emit('major', [championTeamId], { kind: 'champion.crowned', championTeamId });
          const champion = state.teams[championTeamId]!;
          emit('major', [championTeamId], {
            kind: 'news.posted',
            headline: 'event.championCrowned',
            params: { team: teamName(champion) },
          });
          giveSeasonAwards(state, ctx, emit);
          announceDraftClass(
            state,
            ctx,
            rng.fork('draftClass'),
            emit,
            worstFirst(state, ctx.ruleset),
          );
        } else {
          for (const series of nextRound(current)) startSeries(series);
        }
      }
    }

    // League pulse once a week.
    if (phaseOf(cal, today) === 'regular' && today.day % 7 === 6) {
      const rows = leagueStandings(state, ctx.ruleset);
      const odds = playoffOdds({
        teams: Object.values(state.teams),
        schedule: state.schedule,
        results: Object.values(state.results),
        ruleset: ctx.ruleset,
        season: today.season,
        exponent: sport.pythagoreanExponent,
        rng: rng.fork(`pulse${today.day}`),
        sims: PULSE_SIMS,
      });
      const cap = ctx.ruleset.cap.upperLimit;
      const inputs = new Map<TeamId, PulseInput>(
        rows.map(({ teamId }) => {
          const roster = rosters.get(teamId) ?? [];
          const core = roster
            .map((p) => ({ rating: overall(p), age: today.season - p.birthYear }))
            .sort((a, b) => b.rating - a.rating)
            .slice(0, PULSE_CORE);
          const age = core.reduce((s, x) => s + x.age, 0) / Math.max(1, core.length);
          const capRoom = (cap - payroll(roster, ctx.ruleset)) / cap;
          return [teamId, { odds: odds.get(teamId) ?? 0, age, capRoom }];
        }),
      );
      const next = classifyTeams(rows, inputs);
      // In crisis: losing, and the owner has lost faith in the GM (the brief's job 1, first part).
      for (const id of Object.keys(next) as TeamId[]) {
        // AI teams only: a human GM's owner has his own, lower hot-seat lines.
        const ai = !state.teams[id]?.userControlled;
        if (ai && (next[id] === 'seller' || next[id] === 'rebuilder') && aiGmFired(state, id)) {
          next[id] = 'crisis';
        }
      }
      for (const [teamId, to] of Object.entries(next) as [TeamId, (typeof next)[TeamId]][]) {
        const from = state.teamStatus[teamId];
        if (from && from !== to) {
          emit('notable', [teamId], { kind: 'team.statusChanged', teamId, from, to });
        }
      }
      // Forked, so trade talks never shift the games' random numbers.
      const before = events.length;
      aiTrades(state, ctx, rng.fork(`trades${today.day}`), emit);
      aiOffers(state, ctx, rng.fork(`offers${today.day}`), emit);
      tradeRequests(state, rng.fork(`requests${today.day}`), emit);
      aiHoldouts(state, ctx, rng.fork(`aiHoldouts${today.day}`), emit);
      holdoutsWeek(state, rng.fork(`holdouts${today.day}`), emit);
      disputesWeek(state, ctx, rng.fork(`disputes${today.day}`), emit);
      if (events.length > before) loadRosters();
      coachWeek(state, ctx, rng.fork(`coach${today.day}`), emit);
    } else if (inDeadlineWeek(cal, today.day)) {
      // Deadline week is a market: trade talks and calls every day, not once a week.
      const before = events.length;
      aiTrades(state, ctx, rng.fork(`trades${today.day}`), emit);
      aiOffers(state, ctx, rng.fork(`offers${today.day}`), emit);
      if (events.length > before) loadRosters();
    }
    if (today.day === cal.tradeDeadlineDay) deadlineRecap(state, ctx, emit);

    const tomorrow = { season: today.season, day: today.day + 1 };
    const fromPhase = phaseOf(cal, today);
    const toPhase = phaseOf(cal, tomorrow);
    if (fromPhase !== toPhase) {
      emit('major', [], { kind: 'season.phaseChanged', from: fromPhase, to: toPhase });
      if (toPhase === 'playoffs') {
        prospectSeason(state, ctx, rng.fork('prospects'), emit);
        const rows = leagueStandings(state, ctx.ruleset);
        for (const series of seedPlayoffs(
          rows,
          ctx.ruleset,
          today.season,
          Object.values(state.teams),
        )) {
          startSeries(series);
        }
      }
    }

    emit('minor', [], { kind: 'clock.advanced', to: tomorrow, rngState: rng.state });

    // Any list, even an empty one, still stops when you are fired.
    if (stopOn !== 'never' && events.slice(dayStart).some((e) => matters(state, e, stops))) {
      break;
    }
  }
  return events;
}

/** Runs of the rest of the season behind the weekly pulse's playoff odds. */
const PULSE_SIMS = 100;
/** The best players whose average age is a team's age in the pulse. */
const PULSE_CORE = 8;

/** Win or losing streaks of these lengths make the news. */
const STREAK_MILESTONES = [6, 9, 12];

/** A skater this young or younger, 20 games in, scoring 50% above last season's pace has broken out. */
const BREAKOUT_AGE = 23;
const BREAKOUT_GAMES = 20;
const BREAKOUT_PACE = 1.5;
/** Last season's sample must be real: a rookie's handful of games proves nothing. */
const BREAKOUT_MIN_POINTS = 30;
const BREAKOUT_MIN_GAMES = 40;

/** A top-6 skater without a point for this many games is in a slump. */
const SLUMP_GAMES = 10;
const SLUMP_STARS = 6;

/** Injuries at least this long to one of your players stop "sim until it matters". */
const LONG_INJURY_DAYS = 14;

/**
 * Whether an event should stop "sim until it matters": a major league-wide moment (phase change,
 * champion), a major event for a human team (its series, its trade), or a long injury to one of
 * its players. Other teams' trades and series don't.
 */
function matters(state: LeagueState, e: LeagueEvent, stops: ReadonlySet<StopCategory>): boolean {
  const yours = e.teamIds.some((id) => state.teams[id]?.userControlled);
  if (e.kind === 'career.fired') return true; // it was yours a moment ago
  if (e.importance === 'major') {
    return e.teamIds.length === 0 ? stops.has('league') : yours && stops.has('yours');
  }
  if (e.kind === 'trade.offered') return yours && stops.has('offers'); // an offer waits on you
  return (
    e.kind === 'player.injured' && yours && e.days >= LONG_INJURY_DAYS && stops.has('injuries')
  );
}
