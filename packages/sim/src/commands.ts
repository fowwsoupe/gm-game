import type { Actor, Command, CommandResult, LeagueEvent, TeamId } from '@gm/shared';
import { applyEvent, emitter, makeEvent, type LeagueState } from './core';
import { buyoutCharges } from './cba';
import { parsePick } from './league';
import {
  isExpiring,
  openFreeAgency,
  resignContract,
  resignWindowOpen,
  rolloverSeason,
  signFreeAgent,
} from './offseason';
import { evaluateTrade, planRetention } from './trades';
import { advance } from './advance';
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
      const plan = planRetention(state, ctx, proposal);
      const retained = 'retained' in plan ? plan.retained : [];
      const ev = makeEvent(state, 'major', [proposal.fromTeamId, proposal.toTeamId], {
        kind: 'trade.completed',
        fromTeamId: proposal.fromTeamId,
        toTeamId: proposal.toTeamId,
        give: [...proposal.give],
        get: [...proposal.get],
        ...(retained.length > 0 && { retained }),
        ...(proposal.givePicks?.length && { givePicks: [...proposal.givePicks] }),
        ...(proposal.getPicks?.length && { getPicks: [...proposal.getPicks] }),
      });
      applyEvent(state, ev);
      const picks = (ids: readonly string[] = []) =>
        ids.map((id) => {
          const pick = parsePick(id)!;
          return `${pick.season} R${pick.round} (${state.teams[pick.originalTeamId]?.abbreviation})`;
        });
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
          give:
            [names(proposal.give), ...picks(proposal.givePicks)].filter(Boolean).join(', ') || '-',
          get: [names(proposal.get), ...picks(proposal.getPicks)].filter(Boolean).join(', ') || '-',
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
