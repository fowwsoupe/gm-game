import type { Actor, Command, CommandResult, LeagueEvent, Team, TradeProposal } from '@gm/shared';
import { GOALIE_ROTATIONS, TICKET_STEPS } from '@gm/shared';
import {
  Rng,
  applyEvent,
  emitter,
  makeEvent,
  playerName,
  teamName,
  type LeagueState,
} from './core';
import { buyoutCharges, capYearIssues, capYearOf, teamCapTotal } from './cba';
import { parsePick } from './league';
import { DEPARTMENTS, PROMISE_DAYS, talkedDown, talkedRound } from './people';
import {
  isExpiring,
  acceptSheet,
  marketDay,
  openFreeAgency,
  resignContract,
  resignWindowOpen,
  rolloverSeason,
  signFreeAgent,
  staffCandidates,
} from './offseason';
import { evaluateTrade, planRetention } from './trades';
import { advance } from './advance';
import type { SimContext } from './context';

/** A human controls a team if the actor was given it, or is the local player and it is theirs. */
const controls = (actor: Actor, team: Team) =>
  actor.controls.includes(team.id) || (actor.id === 'local' && team.userControlled);
const notYours: CommandResult = {
  ok: false,
  error: { code: 'not_allowed', message: 'not your team' },
};
const invalid = (message: string): CommandResult => ({
  ok: false,
  error: { code: 'invalid', message },
});
/** Applies one event and returns it as the command's result. */
const applied = (state: LeagueState, ev: LeagueEvent): CommandResult => {
  applyEvent(state, ev);
  return { ok: true, events: [ev] };
};

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
        return invalid('days must be 1–400');
      }
      return { ok: true, events: advance(state, command.days, command.stopOn ?? 'never', ctx) };

    case 'team.setUserControlled': {
      if (!state.teams[command.teamId]) return invalid('unknown team');
      if (actor.id !== 'local' && !actor.controls.includes(command.teamId)) return notYours;
      // Fired: the way back in is an offer (`career.takeJob`), not picking a team.
      if (state.career && command.userControlled) return invalid('out of work: take an offer');
      const ev = makeEvent(state, 'minor', [command.teamId], {
        kind: 'team.controlChanged',
        teamId: command.teamId,
        userControlled: command.userControlled,
      });
      return applied(state, ev);
    }

    case 'contract.buyout': {
      const player = state.players[command.playerId];
      const team = player?.teamId ? state.teams[player.teamId] : undefined;
      if (!player || !team || !player.contract) {
        return invalid('no contract to buy out');
      }
      if (!controls(actor, team)) return notYours;
      // The buyout window is the offseason: after the champion is crowned, before the rollover.
      if (!state.championTeamId) {
        return invalid('buyouts open once the season is over');
      }
      const charges = buyoutCharges(ctx.ruleset, {
        teamId: team.id,
        player,
        season: state.date.season,
      });
      if (charges.length === 0) {
        return invalid('the contract ends this season');
      }
      const ev = makeEvent(state, 'notable', [team.id], {
        kind: 'contract.boughtOut',
        playerId: player.id,
        teamId: team.id,
        charges,
      });
      return applied(state, ev);
    }

    case 'contract.resign': {
      const player = state.players[command.playerId];
      const team = player?.teamId ? state.teams[player.teamId] : undefined;
      if (!player || !team) {
        return invalid('unknown player');
      }
      if (!controls(actor, team)) return notYours;
      if (state.tradeRequests.some((r) => r.playerId === player.id)) {
        return invalid('he has asked to be traded');
      }
      if (!resignWindowOpen(state, ctx) || !isExpiring(state, player)) {
        return invalid('only expiring contracts, outside the playoffs');
      }
      const deal = resignContract(state, ctx, player, command.years);
      if ('issues' in deal) {
        return invalid(`illegal contract: ${deal.issues[0]!.code}`);
      }
      // In season it is an extension: the current deal still runs to the end of the year.
      const ev = makeEvent(state, 'notable', [team.id], {
        kind: state.championTeamId ? 'player.signed' : 'contract.extended',
        playerId: player.id,
        teamId: team.id,
        contract: deal.contract,
      });
      return applied(state, ev);
    }

    case 'trade.propose': {
      const { proposal } = command;
      const from = state.teams[proposal.fromTeamId];
      if (!from) return invalid('unknown team');
      if (!controls(actor, from)) return notYours;
      // A human partner accepts any legal trade, so only someone who runs it may propose one.
      const to = state.teams[proposal.toTeamId];
      if (to?.userControlled && !controls(actor, to)) return notYours;
      const verdict = evaluateTrade(state, ctx, proposal);
      if (!verdict.accepted) {
        return invalid(`trade refused: ${verdict.reasons.map((r) => r.code).join(', ')}`);
      }
      return { ok: true, events: completeTrade(state, ctx, proposal) };
    }

    case 'trade.respond': {
      const offer = state.tradeOffers.find((o) => o.id === command.offerId);
      if (!offer) return invalid('no such offer');
      const human = state.teams[offer.proposal.toTeamId]!;
      if (!controls(actor, human)) return notYours;
      const close = (accepted: boolean) => {
        const ev = makeEvent(state, 'minor', [human.id, offer.proposal.fromTeamId], {
          kind: 'trade.offerClosed',
          offerId: offer.id,
          accepted,
        });
        applyEvent(state, ev);
        return ev;
      };
      if (!command.accept) return { ok: true, events: [close(false)] };
      // Seen from your side: you give what they asked for. It must still pass today.
      const mirror = {
        fromTeamId: human.id,
        toTeamId: offer.proposal.fromTeamId,
        give: offer.proposal.get,
        get: offer.proposal.give,
        ...(offer.proposal.getPicks && { givePicks: offer.proposal.getPicks }),
        ...(offer.proposal.givePicks && { getPicks: offer.proposal.givePicks }),
      };
      const verdict = evaluateTrade(state, ctx, mirror);
      if (!verdict.accepted) {
        return invalid(
          `the offer is off the table: ${verdict.reasons.map((r) => r.code).join(', ')}`,
        );
      }
      const events = completeTrade(state, ctx, mirror);
      return { ok: true, events: [...events, close(true)] };
    }

    case 'tradeRequest.talk': {
      const request = state.tradeRequests.find((r) => r.playerId === command.playerId);
      if (!request) return invalid('no such request');
      const team = state.teams[request.teamId]!;
      if (!controls(actor, team)) return notYours;
      const p = state.players[command.playerId]!;
      const withdrawn = talkedDown(p.id);
      const ev = withdrawn
        ? makeEvent(state, 'notable', [team.id], {
            kind: 'player.tradeRequestEnded',
            playerId: p.id,
            withdrawn: true,
          })
        : makeEvent(state, 'notable', [team.id], {
            kind: 'news.posted',
            headline: 'event.requestStands',
            params: { player: playerName(p) },
          });
      return applied(state, ev);
    }

    case 'dispute.talk': {
      const dispute = state.disputes.find((d) => d.playerId === command.playerId);
      if (!dispute) return invalid('no such dispute');
      const team = state.teams[dispute.teamId]!;
      if (!controls(actor, team)) return notYours;
      if (dispute.until !== undefined) return invalid('you already promised him a role');
      if (dispute.listed) return invalid('he is on the block');
      const p = state.players[command.playerId]!;
      // Promises are checked once a week in the regular season: one due later is due at the last check.
      const days = ctx.ruleset.season.calendar.regularSeasonDays;
      const lastWeek = days - 1 - ((days - 7) % 7);
      const ends = (outcome: 'settled' | 'request' | 'listed') =>
        makeEvent(state, 'notable', [team.id], {
          kind: 'player.disputeEnded',
          playerId: p.id,
          outcome,
        });
      const events: LeagueEvent[] = [];
      const push = (ev: LeagueEvent) => {
        applyEvent(state, ev);
        events.push(ev);
      };
      if (command.answer === 'promise') {
        push(
          makeEvent(state, 'notable', [team.id], {
            kind: 'player.disputePromised',
            playerId: p.id,
            until: Math.min(state.date.day + PROMISE_DAYS, lastWeek),
          }),
        );
      } else if (command.answer === 'block') {
        push(
          makeEvent(state, 'minor', [team.id], {
            kind: 'trade.blockSet',
            teamId: team.id,
            playerId: p.id,
            onBlock: true,
          }),
        );
        push(
          makeEvent(state, 'notable', [team.id], { kind: 'player.disputeListed', playerId: p.id }),
        );
      } else if (talkedDown(p.id)) {
        push(ends('settled'));
      } else {
        push(ends('request'));
        if (!state.tradeRequests.some((r) => r.playerId === p.id)) {
          push(
            makeEvent(state, 'major', [team.id], {
              kind: 'player.tradeRequested',
              playerId: p.id,
              teamId: team.id,
            }),
          );
        }
      }
      return { ok: true, events };
    }

    case 'holdout.talk': {
      const holdout = state.holdouts.find((h) => h.playerId === command.playerId);
      if (!holdout) return invalid('no such holdout');
      const team = state.teams[holdout.teamId]!;
      if (!controls(actor, team)) return notYours;
      const p = state.players[command.playerId]!;
      const ev = talkedRound(p.id)
        ? makeEvent(state, 'notable', [team.id], {
            kind: 'player.holdoutEnded',
            playerId: p.id,
            talked: true,
          })
        : makeEvent(state, 'notable', [team.id], {
            kind: 'news.posted',
            headline: 'event.holdoutStands',
            params: { player: playerName(p) },
          });
      return applied(state, ev);
    }

    case 'offseason.openFreeAgency': {
      if (!state.championTeamId || state.freeAgencyOpen) {
        return invalid('free agency opens once, after the season');
      }
      const events: LeagueEvent[] = [];
      openFreeAgency(state, ctx, emitter(state, events));
      return { ok: true, events };
    }

    case 'freeAgency.advanceDay': {
      if (!state.freeAgencyOpen) {
        return invalid('free agency is not open');
      }
      const events: LeagueEvent[] = [];
      // The sim clock does not move in the summer; the event count keeps each day's draws apart.
      const rng = new Rng(state.rngState).fork(`market${state.eventSeq}`);
      marketDay(state, ctx, rng, emitter(state, events));
      return { ok: true, events };
    }

    case 'lines.set': {
      const team = state.teams[command.teamId];
      if (!team) return invalid('unknown team');
      if (!controls(actor, team)) return notYours;
      if (
        new Set(command.order).size !== command.order.length ||
        !command.order.every((id) => state.players[id]?.teamId === team.id)
      ) {
        return invalid('only your own players, once each');
      }
      const ev = makeEvent(state, 'minor', [team.id], {
        kind: 'lines.set',
        teamId: team.id,
        order: [...command.order],
      });
      return applied(state, ev);
    }

    case 'trade.block': {
      const team = state.teams[command.teamId];
      const player = state.players[command.playerId];
      if (!team || !player) {
        return invalid('unknown player or team');
      }
      if (!controls(actor, team)) return notYours;
      if (player.teamId !== team.id) {
        return invalid('only your own players');
      }
      const ev = makeEvent(state, 'minor', [team.id], {
        kind: 'trade.blockSet',
        teamId: team.id,
        playerId: player.id,
        onBlock: command.onBlock,
      });
      return applied(state, ev);
    }

    case 'career.takeJob': {
      if (actor.id !== 'local') return notYours;
      if (!state.career?.offers.includes(command.teamId)) return invalid('no such offer');
      return applied(
        state,
        makeEvent(state, 'major', [command.teamId], {
          kind: 'career.hired',
          teamId: command.teamId,
        }),
      );
    }

    case 'league.setCanBeFired':
      if (actor.id !== 'local') return notYours;
      return applied(
        state,
        makeEvent(state, 'minor', [], { kind: 'league.optionSet', canBeFired: command.on }),
      );

    case 'owner.answerCard': {
      const card = state.ownerCards.find((c) => c.id === command.cardId);
      if (!card) return invalid('no such card');
      if (!controls(actor, state.teams[card.teamId]!)) return notYours;
      const chosen = card.options.find((o) => o.key === command.option);
      if (!chosen) return invalid('no such option');
      const ev = makeEvent(state, 'minor', [card.teamId], {
        kind: 'owner.cardAnswered',
        teamId: card.teamId,
        cardId: card.id,
        cardKind: card.kind,
        option: chosen.key,
        effects: chosen.effects,
      });
      return applied(state, ev);
    }

    case 'finance.setTicketPrice': {
      const team = state.teams[command.teamId];
      if (!team) return invalid('unknown team');
      if (!controls(actor, team)) return notYours;
      if (!(TICKET_STEPS as readonly number[]).includes(command.pct)) {
        return invalid('unknown ticket price step');
      }
      const ev = makeEvent(state, 'minor', [team.id], {
        kind: 'finance.ticketPriceSet',
        teamId: team.id,
        pct: command.pct,
      });
      return applied(state, ev);
    }

    case 'staff.hire': {
      const team = state.teams[command.teamId];
      if (!team) return invalid('unknown team');
      if (!controls(actor, team)) return notYours;
      if (!DEPARTMENTS.includes(command.department)) return invalid('unknown department');
      // Next season's once the champion is crowned, so a summer hire counts for the season ahead.
      const season = capYearOf(state);
      const head = staffCandidates(team, command.department, ctx, season)[command.candidate];
      if (!head) return invalid('unknown candidate');
      if (team.staff?.[command.department]?.hired === season) {
        return invalid('already hired for this department this season');
      }
      const ev = makeEvent(state, 'notable', [team.id], {
        kind: 'staff.hired',
        teamId: team.id,
        department: command.department,
        head,
        poached: false,
      });
      return applied(state, ev);
    }

    case 'goalies.setRotation': {
      const team = state.teams[command.teamId];
      if (!team) return invalid('unknown team');
      if (!controls(actor, team)) return notYours;
      if (!GOALIE_ROTATIONS.includes(command.rotation)) {
        return invalid('unknown rotation');
      }
      const ev = makeEvent(state, 'minor', [team.id], {
        kind: 'goalies.rotationSet',
        teamId: team.id,
        rotation: command.rotation,
      });
      return applied(state, ev);
    }

    case 'units.set': {
      const team = state.teams[command.teamId];
      if (!team) return invalid('unknown team');
      if (!controls(actor, team)) return notYours;
      const ps = command.playerIds.map((id) => state.players[id]);
      if (
        command.playerIds.length &&
        (!ps.every((p) => p?.teamId === team.id) ||
          !ctx.sport.unitOk(command.unit, ps as NonNullable<(typeof ps)[number]>[]))
      ) {
        return invalid('your own skaters, the right mix, once each');
      }
      const ev = makeEvent(state, 'minor', [team.id], {
        kind: 'units.set',
        teamId: team.id,
        unit: command.unit,
        playerIds: [...command.playerIds],
      });
      return applied(state, ev);
    }

    case 'draft.setBoard': {
      const team = state.teams[command.teamId];
      if (!team) return invalid('unknown team');
      if (!controls(actor, team)) return notYours;
      const eligible = new Set(state.draftClass.map((d) => d.player.id as string));
      if (
        new Set(command.order).size !== command.order.length ||
        !command.order.every((id) => eligible.has(id))
      ) {
        return invalid('not in the draft class');
      }
      const ev = makeEvent(state, 'minor', [team.id], {
        kind: 'draft.boardSet',
        teamId: team.id,
        order: [...command.order],
      });
      return applied(state, ev);
    }

    case 'freeAgency.matchSheet':
    case 'freeAgency.declineSheet': {
      const team = state.teams[command.teamId];
      if (!team) return invalid('unknown team');
      if (!controls(actor, team)) return notYours;
      const sheet = state.rfaSheets.find((o) => o.playerId === command.playerId);
      const player = state.players[command.playerId];
      if (!sheet || !player || state.rfaRights[player.id] !== team.id) {
        return invalid('no offer sheet for that player');
      }
      if (command.kind === 'freeAgency.declineSheet') {
        const events: LeagueEvent[] = [];
        acceptSheet(state, ctx, emitter(state, events), sheet);
        return { ok: true, events };
      }
      // He signs on the sheet's terms, so only cap room can stop a match (no interest check).
      const salary = sheet.salary;
      const total = teamCapTotal(state, team.id) + salary;
      if (capYearIssues(ctx.ruleset, state, total).length > 0) {
        return invalid('no cap room');
      }
      const ev = makeEvent(state, 'notable', [team.id, sheet.teamId], {
        kind: 'player.signed',
        playerId: player.id,
        teamId: team.id,
        contract: { capHit: salary, expiresAfterSeason: capYearOf(state) + sheet.years - 1 },
        staying: true,
      });
      return applied(state, ev);
    }

    case 'contract.sign': {
      const player = state.players[command.playerId];
      const team = state.teams[command.teamId];
      if (!player || !team) {
        return invalid('unknown player or team');
      }
      if (!controls(actor, team)) return notYours;
      const deal = signFreeAgent(state, ctx, player, team.id, command);
      if ('error' in deal) return invalid(deal.error);
      // With AI offers on the table he weighs them all tomorrow; otherwise he decides now.
      // A restricted free agent's own team gets to match first: an offer sheet is never instant.
      const rights = state.rfaRights[player.id];
      const contested =
        (rights !== undefined && rights !== team.id) ||
        state.faOffers.some((o) => o.playerId === player.id && o.teamId !== team.id);
      const ev = contested
        ? makeEvent(state, 'minor', [team.id], {
            kind: 'freeAgency.offered',
            offer: {
              playerId: player.id,
              teamId: team.id,
              salary: deal.contract.capHit,
              years: command.years,
              ...(command.noTrade && { noTrade: true as const }),
              ...(command.bonusPct && { bonusPct: command.bonusPct }),
            },
          })
        : makeEvent(state, 'notable', [team.id], {
            kind: 'player.signed',
            playerId: player.id,
            teamId: team.id,
            contract: deal.contract,
          });
      return applied(state, ev);
    }

    case 'season.rollover': {
      if (!state.championTeamId) {
        return invalid('the season is not over yet');
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

/** Applies an accepted trade: the trade itself (with any retained salary) and its headline. */
function completeTrade(
  state: LeagueState,
  ctx: SimContext,
  proposal: TradeProposal,
): LeagueEvent[] {
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
    ...(proposal.protectTop && proposal.givePicks?.length && { protectTop: proposal.protectTop }),
  });
  applyEvent(state, ev);
  const picks = (ids: readonly string[] = []) =>
    ids.map((id) => {
      const pick = parsePick(id)!;
      return `${pick.season} R${pick.round} (${state.teams[pick.originalTeamId]?.abbreviation})`;
    });
  const names = (ids: readonly string[]) =>
    ids.map((id) => playerName(state.players[id]!)).join(', ');
  const news = makeEvent(state, 'notable', [proposal.fromTeamId, proposal.toTeamId], {
    kind: 'news.posted',
    headline: 'event.trade',
    params: {
      from: teamName(state.teams[proposal.fromTeamId]!),
      to: teamName(state.teams[proposal.toTeamId]!),
      give: [names(proposal.give), ...picks(proposal.givePicks)].filter(Boolean).join(', ') || '-',
      get: [names(proposal.get), ...picks(proposal.getPicks)].filter(Boolean).join(', ') || '-',
    },
  });
  applyEvent(state, news);
  return [ev, news];
}
