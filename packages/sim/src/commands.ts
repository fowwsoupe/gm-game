import type {
  Actor,
  Command,
  CommandResult,
  GameId,
  GameResult,
  LeagueEvent,
  Player,
  TeamId,
} from '@gm/shared';
import {
  applyEvent,
  emitter,
  makeEvent,
  phaseOf,
  Rng,
  type LeagueState,
  type ScheduledGame,
} from './core';
import { buyoutCharges } from './cba';
import { classifyTeams, computeStandings, nextRound, seedPlayoffs } from './league';
import { giveSeasonAwards } from './awards';
import { rolloverSeason } from './offseason';
import type { SimContext } from './context';

/**
 * The single entry point for changing a league. Every command, from any human (local or,
 * later, remote) or AI GM, goes through here and comes back as events.
 *
 * Contract: `handleCommand` mutates `state` only through `applyEvent`, and returns every
 * event it applied. Another copy of the state (the main process, a multiplayer client)
 * that applies the same events ends up identical.
 */
export function handleCommand(
  state: LeagueState,
  command: Command,
  actor: Actor,
  ctx: SimContext,
): CommandResult {
  switch (command.kind) {
    case 'sim.advance':
      if (command.days < 1 || command.days > 400) {
        return { ok: false, error: { code: 'invalid', message: 'days must be 1–400' } };
      }
      return { ok: true, events: advance(state, command.days, command.stopOn ?? 'never', ctx) };

    case 'team.setUserControlled': {
      if (!state.teams[command.teamId])
        return { ok: false, error: { code: 'invalid', message: 'unknown team' } };
      if (actor.id !== 'local' && !actor.controls.includes(command.teamId)) {
        return { ok: false, error: { code: 'not_allowed', message: 'not your team' } };
      }
      const ev = makeEvent(state, 'minor', [command.teamId], {
        kind: 'team.controlChanged',
        teamId: command.teamId,
        userControlled: command.userControlled,
      });
      applyEvent(state, ev);
      return { ok: true, events: [ev] };
    }

    case 'contract.buyout': {
      const player = state.players[command.playerId];
      const team = player?.teamId ? state.teams[player.teamId] : undefined;
      if (!player || !team || !player.contract) {
        return { ok: false, error: { code: 'invalid', message: 'no contract to buy out' } };
      }
      const yours =
        actor.controls.includes(team.id) || (actor.id === 'local' && team.userControlled);
      if (!yours) return { ok: false, error: { code: 'not_allowed', message: 'not your team' } };
      // The buyout window is the offseason: after the champion is crowned, before the rollover.
      if (!state.championTeamId) {
        return {
          ok: false,
          error: { code: 'invalid', message: 'buyouts open once the season is over' },
        };
      }
      const charges = buyoutCharges(ctx.ruleset, {
        teamId: team.id,
        player,
        season: state.date.season,
      });
      if (charges.length === 0) {
        return {
          ok: false,
          error: { code: 'invalid', message: 'the contract ends this season' },
        };
      }
      const ev = makeEvent(state, 'notable', [team.id], {
        kind: 'contract.boughtOut',
        playerId: player.id,
        teamId: team.id,
        charges,
      });
      applyEvent(state, ev);
      return { ok: true, events: [ev] };
    }

    case 'season.rollover': {
      if (!state.championTeamId) {
        return { ok: false, error: { code: 'invalid', message: 'the season is not over yet' } };
      }
      const events: LeagueEvent[] = [];
      rolloverSeason(state, ctx, emitter(state, events));
      return { ok: true, events };
    }

    default: {
      const unhandled: never = command;
      return {
        ok: false,
        error: { code: 'not_implemented', message: `command ${(unhandled as Command).kind}` },
      };
    }
  }
}

function advance(
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
  for (const p of Object.values(state.players)) {
    if (p.teamId) rosters.set(p.teamId, [...(rosters.get(p.teamId) ?? []), p]);
  }
  const strengths = new Map<TeamId, { out: string; strength: unknown }>();
  const strengthOf = (team: TeamId, day: number) => {
    const roster = rosters.get(team) ?? [];
    const hurt = roster.filter((p) => (p.injuredUntil ?? 0) > day);
    const out = hurt.map((p) => p.id).join();
    let cached = strengths.get(team);
    if (!cached || cached.out !== out) {
      const healthy = hurt.length ? roster.filter((p) => !hurt.includes(p)) : roster;
      cached = { out, strength: sport.teamStrength(healthy) };
      strengths.set(team, cached);
    }
    return cached.strength;
  };
  /** Records a finished game and the injuries it caused (the injuries are not kept on the result). */
  const finishGame = (result: GameResult, day: number) => {
    const { injuries = [], ...game } = result;
    emit(
      makeEvent(state, 'minor', [game.homeTeamId, game.awayTeamId], {
        kind: 'game.final',
        result: game,
      }),
    );
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

    if (stopOn === 'major' && events.slice(dayStart).some((e) => e.importance === 'major')) break;
  }
  return events;
}
