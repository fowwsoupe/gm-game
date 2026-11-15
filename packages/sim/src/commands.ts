import type {
  Actor,
  Command,
  CommandResult,
  GameId,
  Importance,
  LeagueEvent,
  TeamId,
} from '@gm/shared';
import { applyEvent, eventId, phaseOf, Rng, type LeagueState, type ScheduledGame } from './core';
import { classifyTeams, computeStandings, nextRound, seedPlayoffs } from './league';
import type { SimContext } from './context';

/**
 * Note: every event made with `makeEvent` must be applied (via `applyEvent`) before the next
 * one is made: ids come from `state.eventSeq`, which only the reducer advances.
 *
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

    default: {
      const unhandled: never = command;
      return {
        ok: false,
        error: { code: 'not_implemented', message: `command ${(unhandled as Command).kind}` },
      };
    }
  }
}

type EventBody = LeagueEvent extends infer E
  ? E extends LeagueEvent
    ? Omit<E, 'id' | 'date' | 'importance' | 'teamIds'>
    : never
  : never;

function makeEvent(
  state: LeagueState,
  importance: Importance,
  teamIds: TeamId[],
  body: EventBody,
): LeagueEvent {
  return {
    ...body,
    id: eventId(state.date.season, state.date.day, state.eventSeq),
    date: { ...state.date },
    importance,
    teamIds,
  } as LeagueEvent;
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

  // Precompute once per call: team strength and games by day.
  const sport = ctx.sport;
  const strength = new Map<TeamId, unknown>();
  const players = Object.values(state.players);
  for (const id of Object.keys(state.teams) as TeamId[]) {
    strength.set(id, sport.teamStrength(players.filter((p) => p.teamId === id)));
  }
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
          home: strength.get(g.homeTeamId),
          away: strength.get(g.awayTeamId),
        },
        rng,
      );
      emit(makeEvent(state, 'minor', [g.homeTeamId, g.awayTeamId], { kind: 'game.final', result }));
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
            home: strength.get(homeTeamId),
            away: strength.get(awayTeamId),
            playoff: true,
          },
          rng,
        );
        result.playoffSeriesId = series.id;
        emit(makeEvent(state, 'minor', [homeTeamId, awayTeamId], { kind: 'game.final', result }));
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
        for (const series of seedPlayoffs(rows, ctx.ruleset, today.season)) {
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
