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
import {
  announceDraftClass,
  isExpiring,
  openFreeAgency,
  resignContract,
  resignWindowOpen,
  rolloverSeason,
  signFreeAgent,
} from './offseason';
import { aiTrades, evaluateTrade } from './trades';
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

    case 'contract.resign': {
      const player = state.players[command.playerId];
      const team = player?.teamId ? state.teams[player.teamId] : undefined;
      if (!player || !team) {
        return { ok: false, error: { code: 'invalid', message: 'unknown player' } };
      }
      const yours =
        actor.controls.includes(team.id) || (actor.id === 'local' && team.userControlled);
      if (!yours) return { ok: false, error: { code: 'not_allowed', message: 'not your team' } };
      if (!resignWindowOpen(state, ctx) || !isExpiring(state, player)) {
        return {
          ok: false,
          error: { code: 'invalid', message: 'only expiring contracts, outside the playoffs' },
        };
      }
      const deal = resignContract(state, ctx, player, command.years);
      if ('issues' in deal) {
        return {
          ok: false,
          error: { code: 'invalid', message: `illegal contract: ${deal.issues[0]!.code}` },
        };
      }
      // In season it is an extension: the current deal still runs to the end of the year.
      const ev = makeEvent(state, 'notable', [team.id], {
        kind: state.championTeamId ? 'player.signed' : 'contract.extended',
        playerId: player.id,
        teamId: team.id,
        contract: deal.contract,
      });
      applyEvent(state, ev);
      return { ok: true, events: [ev] };
    }

    case 'trade.propose': {
      const { proposal } = command;
      const from = state.teams[proposal.fromTeamId];
      if (!from) return { ok: false, error: { code: 'invalid', message: 'unknown team' } };
      const yours =
        actor.controls.includes(from.id) || (actor.id === 'local' && from.userControlled);
      if (!yours) return { ok: false, error: { code: 'not_allowed', message: 'not your team' } };
      const verdict = evaluateTrade(state, ctx, proposal);
      if (!verdict.accepted) {
        return {
          ok: false,
          error: {
            code: 'invalid',
            message: `trade refused: ${verdict.reasons.map((r) => r.code).join(', ')}`,
          },
        };
      }
      const ev = makeEvent(state, 'major', [proposal.fromTeamId, proposal.toTeamId], {
        kind: 'trade.completed',
        fromTeamId: proposal.fromTeamId,
        toTeamId: proposal.toTeamId,
        give: [...proposal.give],
        get: [...proposal.get],
      });
      applyEvent(state, ev);
      const names = (ids: readonly string[]) =>
        ids
          .map((id) => `${state.players[id]!.firstName} ${state.players[id]!.lastName}`)
          .join(', ');
      const team = (id: TeamId) => `${state.teams[id]!.city} ${state.teams[id]!.name}`;
      const news = makeEvent(state, 'notable', [proposal.fromTeamId, proposal.toTeamId], {
        kind: 'news.posted',
        headline: 'event.trade',
        params: {
          from: team(proposal.fromTeamId),
          to: team(proposal.toTeamId),
          give: names(proposal.give) || '-',
          get: names(proposal.get) || '-',
        },
      });
      applyEvent(state, news);
      return { ok: true, events: [ev, news] };
    }

    case 'offseason.openFreeAgency': {
      if (!state.championTeamId || state.freeAgencyOpen) {
        return {
          ok: false,
          error: { code: 'invalid', message: 'free agency opens once, after the season' },
        };
      }
      const events: LeagueEvent[] = [];
      openFreeAgency(state, ctx, emitter(state, events));
      return { ok: true, events };
    }

    case 'lines.set': {
      const team = state.teams[command.teamId];
      if (!team) return { ok: false, error: { code: 'invalid', message: 'unknown team' } };
      const yours =
        actor.controls.includes(team.id) || (actor.id === 'local' && team.userControlled);
      if (!yours) return { ok: false, error: { code: 'not_allowed', message: 'not your team' } };
      if (
        new Set(command.order).size !== command.order.length ||
        !command.order.every((id) => state.players[id]?.teamId === team.id)
      ) {
        return {
          ok: false,
          error: { code: 'invalid', message: 'only your own players, once each' },
        };
      }
      const ev = makeEvent(state, 'minor', [team.id], {
        kind: 'lines.set',
        teamId: team.id,
        order: [...command.order],
      });
      applyEvent(state, ev);
      return { ok: true, events: [ev] };
    }

    case 'draft.setBoard': {
      const team = state.teams[command.teamId];
      if (!team) return { ok: false, error: { code: 'invalid', message: 'unknown team' } };
      const yours =
        actor.controls.includes(team.id) || (actor.id === 'local' && team.userControlled);
      if (!yours) return { ok: false, error: { code: 'not_allowed', message: 'not your team' } };
      const eligible = new Set(state.draftClass.map((d) => d.player.id as string));
      if (
        new Set(command.order).size !== command.order.length ||
        !command.order.every((id) => eligible.has(id))
      ) {
        return { ok: false, error: { code: 'invalid', message: 'not in the draft class' } };
      }
      const ev = makeEvent(state, 'minor', [team.id], {
        kind: 'draft.boardSet',
        teamId: team.id,
        order: [...command.order],
      });
      applyEvent(state, ev);
      return { ok: true, events: [ev] };
    }

    case 'contract.sign': {
      const player = state.players[command.playerId];
      const team = state.teams[command.teamId];
      if (!player || !team) {
        return { ok: false, error: { code: 'invalid', message: 'unknown player or team' } };
      }
      const yours =
        actor.controls.includes(team.id) || (actor.id === 'local' && team.userControlled);
      if (!yours) return { ok: false, error: { code: 'not_allowed', message: 'not your team' } };
      const deal = signFreeAgent(state, ctx, player, team.id, command);
      if ('error' in deal) return { ok: false, error: { code: 'invalid', message: deal.error } };
      const ev = makeEvent(state, 'notable', [team.id], {
        kind: 'player.signed',
        playerId: player.id,
        teamId: team.id,
        contract: deal.contract,
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
