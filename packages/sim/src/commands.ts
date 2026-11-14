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
import { simGame, teamStrength, type TeamStrength } from './game';
import { classifyTeams, computeStandings } from './league';
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
  const strength = new Map<TeamId, TeamStrength>();
  const players = Object.values(state.players);
  for (const id of Object.keys(state.teams) as TeamId[]) {
    strength.set(id, teamStrength(players.filter((p) => p.teamId === id)));
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
      const result = simGame(
        {
          id: g.id as GameId,
          homeTeamId: g.homeTeamId,
          awayTeamId: g.awayTeamId,
          home: strength.get(g.homeTeamId)!,
          away: strength.get(g.awayTeamId)!,
        },
        rng,
        ctx.models.goal,
      );
      emit(makeEvent(state, 'minor', [g.homeTeamId, g.awayTeamId], { kind: 'game.final', result }));
    }

    // League pulse once a week.
    if (today.day % 7 === 6) {
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
