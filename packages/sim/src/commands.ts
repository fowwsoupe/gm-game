import type {
  Actor,
  Command,
  CommandResult,
  HallOfFamer,
  LeagueEvent,
  Player,
  Team,
  TeamId,
  TradeProposal,
} from '@gm/shared';
import { GOALIE_ROTATIONS, MARKET_SIZES, STOP_CATEGORIES, TICKET_STEPS } from '@gm/shared';
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
import { expansionDraft, pickLabel, thinnestDivision } from './league';
import {
  departmentsOf,
  moraleOf,
  newCoach,
  PROMISE_DAYS,
  randomGm,
  staffOf,
  talkedDown,
  talkedRound,
  waivesNoTrade,
} from './people';
import {
  isExpiring,
  acceptSheet,
  continueDraft,
  draftPlayer,
  onTheClock,
  startDraft,
  marketDay,
  openFreeAgency,
  prospectDeal,
  resignContract,
  resignWindowOpen,
  rolloverSeason,
  signFreeAgent,
  staffCandidates,
  interimHead,
} from './offseason';
import { evaluateTrade, offerExpires, planRetention } from './trades';
import { pressQuestion } from './owner';
import { overall } from './players';
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
/** A trimmed, valid city, name and abbreviation (unique among the other teams), or the reason it is not. */
function checkIdentity(
  state: LeagueState,
  c: { city: string; name: string; abbreviation: string },
  exceptId?: TeamId,
) {
  const city = c.city.trim();
  const name = c.name.trim();
  const abbreviation = c.abbreviation.trim().toUpperCase();
  if (!city || !name || city.length > 24 || name.length > 24)
    return 'city and name: 1–24 characters';
  if (!/^[A-Z]{2,4}$/.test(abbreviation)) return 'abbreviation: 2–4 letters';
  if (Object.values(state.teams).some((t) => t.id !== exceptId && t.abbreviation === abbreviation))
    return 'abbreviation already taken';
  return { city, name, abbreviation };
}
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
  /** Hall of Famers (the save's, not the league state's): who can come back as staff. */
  legends: readonly HallOfFamer[] = [],
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

    case 'league.expand': {
      if (actor.id !== 'local') return notYours;
      if (!state.freeAgencyOpen) return invalid('expansion happens once free agency is open');
      const { maxTeams } = ctx.ruleset.expansion;
      if (Object.keys(state.teams).length >= maxTeams) return invalid(`at most ${maxTeams} teams`);
      const identity = checkIdentity(state, command);
      if (typeof identity === 'string') return invalid(identity);
      if (!(MARKET_SIZES as readonly number[]).includes(command.market))
        return invalid('unknown market size');
      const rng = new Rng(state.rngState).fork(`expansion${state.eventSeq}`);
      let n = Object.keys(state.teams).length;
      while (state.teams[`t${n}` as TeamId]) n++;
      const team: Team = {
        id: `t${n}` as TeamId,
        ...identity,
        ...thinnestDivision(Object.values(state.teams)),
        market: command.market,
        userControlled: false,
        gm: randomGm(rng.fork('gm')),
        coach: newCoach(rng.fork('coach'), state.date.season + 1, ctx.ruleset.finance.coach),
      };
      return applied(
        state,
        makeEvent(state, 'major', [team.id], {
          kind: 'team.expanded',
          team,
          taken: expansionDraft(state, ctx.ruleset),
        }),
      );
    }

    case 'commissioner.move': {
      if (actor.id !== 'local') return notYours;
      const player = state.players[command.playerId];
      if (!player?.teamId || !player.contract) return invalid('not a rostered player');
      if (command.teamId === player.teamId) return invalid('already there');
      if (command.teamId && !state.teams[command.teamId]) return invalid('unknown team');
      return applied(
        state,
        makeEvent(state, 'notable', [player.teamId, ...(command.teamId ? [command.teamId] : [])], {
          kind: 'player.moved',
          playerId: player.id,
          toTeamId: command.teamId,
        }),
      );
    }

    case 'team.rename':
    case 'team.relocate': {
      const team = state.teams[command.teamId];
      if (!team) return invalid('unknown team');
      // The local player edits any team's identity (sandbox); a remote player only his own.
      if (actor.id !== 'local' && !actor.controls.includes(team.id)) return notYours;
      const checked = checkIdentity(state, command, team.id);
      if (typeof checked === 'string') return invalid(checked);
      const identity = { teamId: team.id, ...checked };
      if (command.kind === 'team.rename')
        return applied(
          state,
          makeEvent(state, 'minor', [team.id], { kind: 'team.renamed', ...identity }),
        );
      if (!(MARKET_SIZES as readonly number[]).includes(command.market))
        return invalid('unknown market size');
      return applied(
        state,
        makeEvent(state, 'notable', [team.id], {
          kind: 'team.relocated',
          ...identity,
          market: command.market,
          fanLoss: ctx.ruleset.finance.relocationFanLoss,
        }),
      );
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

    case 'contract.askWaiveNoTrade': {
      const { proposal } = command;
      const from = state.teams[proposal.fromTeamId];
      if (!from) return invalid('unknown team');
      if (!controls(actor, from)) return notYours;
      const asked = proposal.give
        .map((id) => state.players[id])
        .filter((p) => p?.teamId === from.id && p.contract?.noTrade) as Player[];
      if (asked.length === 0) return invalid('nobody to ask');
      // The trade has to be legal and acceptable with the clauses lifted, or there is nothing to ask.
      const lifted = Object.fromEntries(
        asked.map((p) => {
          const contract = { ...p.contract! };
          delete contract.noTrade;
          return [p.id, { ...p, contract }];
        }),
      );
      const verdict = evaluateTrade(
        { ...state, players: { ...state.players, ...lifted } },
        ctx,
        proposal,
      );
      if (!verdict.accepted) {
        return invalid(`trade refused: ${verdict.reasons.map((r) => r.code).join(', ')}`);
      }
      const no = asked.find((p) => !waivesNoTrade(p.id, moraleOf(state, ctx, p).value));
      if (no) {
        return applied(
          state,
          makeEvent(state, 'notable', [from.id], {
            kind: 'news.posted',
            headline: 'event.noTradeRefused',
            playerId: no.id,
            params: { player: playerName(no) },
          }),
        );
      }
      const events = asked.map((p) =>
        applied(
          state,
          makeEvent(state, 'notable', [from.id], { kind: 'player.noTradeWaived', playerId: p.id }),
        ),
      );
      return {
        ok: true,
        events: [
          ...events.flatMap((r) => (r.ok ? r.events : [])),
          ...tradeOrOffer(state, ctx, proposal),
        ],
      };
    }

    case 'trade.propose': {
      const { proposal } = command;
      const from = state.teams[proposal.fromTeamId];
      if (!from) return invalid('unknown team');
      if (!controls(actor, from)) return notYours;
      const verdict = evaluateTrade(state, ctx, proposal);
      if (!verdict.accepted) {
        return invalid(`trade refused: ${verdict.reasons.map((r) => r.code).join(', ')}`);
      }
      return { ok: true, events: tradeOrOffer(state, ctx, proposal) };
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
      // Another human GM's offer is judged as he wrote it (with his retention), legality only.
      const caller = state.teams[offer.proposal.fromTeamId]!;
      const deal = caller.userControlled ? offer.proposal : mirror;
      // A draft-day call stands while the pick is on the clock: the caller wants a player there,
      // not the pick's value, so only the trade's legality is checked.
      const clock = onTheClock(state, ctx)?.id;
      const judged =
        clock && offer.proposal.getPicks?.includes(clock)
          ? {
              ...state,
              teams: { ...state.teams, [caller.id]: { ...caller, userControlled: true } },
            }
          : state;
      const verdict = evaluateTrade(judged, ctx, deal);
      if (!verdict.accepted) {
        return invalid(
          `the offer is off the table: ${verdict.reasons.map((r) => r.code).join(', ')}`,
        );
      }
      // Closed first: a live draft that runs on closes offers for the picks it uses.
      const closed = close(true);
      return { ok: true, events: [closed, ...completeTrade(state, ctx, deal)] };
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
            playerId: p.id,
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
            playerId: p.id,
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

    case 'offseason.startDraft': {
      if (!state.championTeamId || state.freeAgencyOpen || state.draftPicksMade !== null) {
        return invalid('the draft opens once, after the season');
      }
      const events: LeagueEvent[] = [];
      startDraft(state, ctx, emitter(state, events));
      return { ok: true, events };
    }

    case 'draft.pick': {
      const team = state.teams[command.teamId];
      if (!team) return invalid('unknown team');
      if (!controls(actor, team)) return notYours;
      const clock = onTheClock(state, ctx);
      if (!clock || clock.teamId !== team.id) return invalid('not on the clock');
      if (!state.draftClass.some((d) => d.player.id === command.playerId)) {
        return invalid('not in the draft class');
      }
      const events: LeagueEvent[] = [];
      const emit = emitter(state, events);
      draftPlayer(state, ctx, emit, clock, command.playerId);
      continueDraft(state, ctx, emit, true);
      return { ok: true, events };
    }

    case 'prospect.sign': {
      const team = state.teams[command.teamId];
      if (!team) return invalid('unknown team');
      if (!controls(actor, team)) return notYours;
      const pr = state.prospects[command.playerId];
      if (pr?.player.teamId !== team.id) return invalid('not one of your prospects');
      if (!resignWindowOpen(state, ctx)) return invalid('signings are closed in the playoffs');
      const deal = prospectDeal(ctx, pr, capYearOf(state));
      if (!deal) return invalid('no entry deal at his age');
      const total = teamCapTotal(state, team.id) + deal.capHit;
      if (capYearIssues(ctx.ruleset, state, total).length) return invalid('no cap room');
      return applied(
        state,
        makeEvent(state, 'notable', [team.id], {
          kind: 'prospect.signed',
          playerId: pr.player.id,
          teamId: team.id,
          contract: deal,
        }),
      );
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

    case 'training.set': {
      const team = state.teams[command.teamId];
      const player = state.players[command.playerId];
      if (!team || !player) return invalid('unknown player or team');
      if (!controls(actor, team)) return notYours;
      if (player.teamId !== team.id) return invalid('only your own players');
      if (
        command.focus !== null &&
        !Object.hasOwn(ctx.sport.trainingFocus(player.position), command.focus)
      ) {
        return invalid('unknown training focus');
      }
      const ev = makeEvent(state, 'minor', [team.id], {
        kind: 'training.planSet',
        teamId: team.id,
        playerId: player.id,
        focus: command.focus,
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

    case 'league.setStopOn':
      if (actor.id !== 'local') return notYours;
      return applied(
        state,
        makeEvent(state, 'minor', [], {
          kind: 'league.optionSet',
          stopOn: STOP_CATEGORIES.filter((c) => command.stopOn.includes(c)),
        }),
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
      applyEvent(state, ev);
      if (!card.kind.startsWith('press')) return { ok: true, events: [ev] };
      // Your answer becomes a headline.
      const quote = makeEvent(state, 'notable', [card.teamId], {
        kind: 'news.posted',
        headline: `press.quote.${chosen.key}`,
        params: { team: teamName(state.teams[card.teamId]!) },
      });
      applyEvent(state, quote);
      return { ok: true, events: [ev, quote] };
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
      if (!departmentsOf(team).includes(command.department)) return invalid('unknown department');
      // Next season's once the champion is crowned, so a summer hire counts for the season ahead.
      const season = capYearOf(state);
      const head = staffCandidates(team, command.department, ctx, season, legends)[
        command.candidate
      ];
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

    case 'staff.fire': {
      const team = state.teams[command.teamId];
      if (!team) return invalid('unknown team');
      if (!controls(actor, team)) return notYours;
      if (!departmentsOf(team).includes(command.department)) return invalid('unknown department');
      const season = capYearOf(state);
      const gone = staffOf(team, command.department, ctx.ruleset.frontOffice.salary, season);
      if (gone.hired === season) return invalid('already changed for this department this season');
      // The rest of his salary this season; in camp or once the champion is crowned, the whole
      // season ahead.
      const days = ctx.ruleset.season.calendar.regularSeasonDays;
      const left = state.championTeamId
        ? 1
        : Math.min(1, Math.max(0, (days - state.date.day) / days));
      const ev = makeEvent(state, 'notable', [team.id], {
        kind: 'staff.fired',
        teamId: team.id,
        department: command.department,
        head: interimHead(team, command.department, ctx, season),
        severance: Math.round(gone.salary * left),
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

/**
 * Hot-seat: a trade with another human GM's team needs both, so it is sent to him as an offer
 * (he answers with `trade.respond` when he has the seat). Any other accepted trade goes through.
 */
function tradeOrOffer(state: LeagueState, ctx: SimContext, proposal: TradeProposal): LeagueEvent[] {
  const { fromTeamId, toTeamId } = proposal;
  if (!state.teams[toTeamId]?.userControlled) return completeTrade(state, ctx, proposal);
  const { season, day } = state.date;
  const ev = makeEvent(state, 'notable', [toTeamId, fromTeamId], {
    kind: 'trade.offered',
    offer: {
      id: `h${season}_${day}_${fromTeamId}_${toTeamId}_${state.tradeOffers.length}`,
      proposal: structuredClone(proposal),
      expiresDay: offerExpires(state, ctx),
    },
  });
  applyEvent(state, ev);
  return [ev];
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
  const picks = (ids: readonly string[] = []) => ids.map((id) => pickLabel(state, id));
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
  const events = [ev, news];
  // A pick on the clock traded to an AI team: the live draft runs on to the next human pick.
  if (state.draftPicksMade !== null) continueDraft(state, ctx, emitter(state, events), true);
  // A human GM is asked about a blockbuster: a traded player among his team's top three.
  const traded = new Set([...proposal.give, ...proposal.get]);
  for (const teamId of [proposal.fromTeamId, proposal.toTeamId]) {
    const gone = proposal.fromTeamId === teamId ? proposal.give : proposal.get;
    const top = Object.values(state.players)
      .filter((p) => p.teamId === teamId || gone.includes(p.id))
      .sort((a, b) => overall(b) - overall(a))
      .slice(0, 3);
    if (top.some((p) => traded.has(p.id))) {
      pressQuestion(state, emitter(state, events), teamId, 'pressTrade', 0);
    }
  }
  return events;
}
