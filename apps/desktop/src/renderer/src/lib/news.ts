import type { LeagueEvent } from '@gm/shared';
import { useFeed, useTeams } from '@/lib/queries';
import { money, teamName } from '@/lib/format';
import { isMessageKey, useT, type MessageKey } from '@/i18n';

/** Matches the sim's "long injury" for stopping the sim. */
const LONG_INJURY = 14;

/** A feed line: the event, its text, the one player it is about and who speaks (for faces). */
export interface Post {
  event: LeagueEvent;
  text: string;
  player: string | null;
  by: NonNullable<Extract<LeagueEvent, { kind: 'news.posted' }>['by']> | null;
  /** The story it belongs to (`storyOf`), if any. */
  story: string | null;
}

/**
 * The newest `limit` notable events as feed lines, for Home's card and the News tab. Events
 * the feed has no line for are left out.
 */
export function usePosts(limit: number) {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const { data } = useFeed(limit);
  const names = data?.names ?? {};
  const ages = data?.ages ?? {};
  const who = (id: string) => names[id] ?? '';
  const team = (id: string) => teamName(teams, id);
  const yours = (ids: readonly string[]) =>
    ids.some((id) => teams.find((x) => x.id === id)?.userControlled);

  const describe = (e: LeagueEvent): string | null => {
    switch (e.kind) {
      case 'team.statusChanged':
        return t('event.statusChanged', { team: team(e.teamId), status: t(`status.${e.to}`) });
      case 'player.moved':
        return t('event.moved', {
          player: who(e.playerId),
          team: e.toTeamId ? team(e.toTeamId) : t('roster.freeAgents'),
        });
      case 'team.expanded':
        return t('event.expanded', { team: `${e.team.city} ${e.team.name}`, n: e.taken.length });
      case 'team.relocated':
        return t('event.relocated', { team: `${e.city} ${e.name}` });
      case 'draft.classAnnounced':
        return t('event.draftClass');
      case 'player.injured':
        // Short knocks elsewhere in the league are noise; yours and long ones are news.
        if (e.days < LONG_INJURY && !yours(e.teamIds)) return null;
        return t('event.injured', {
          player: who(e.playerId),
          team: team(e.teamIds[0] ?? ''),
          days: e.days,
        });
      case 'bonuses.paid': {
        const mine = e.paid.filter((x) => yours([x.teamId]));
        if (!mine.length) return null;
        const teamId = mine[0]!.teamId;
        return t('event.bonusesPaid', {
          team: team(teamId),
          amount: money(mine.reduce((s, x) => s + x.amount, 0)),
          over: money(
            e.charges.filter((c) => c.teamId === teamId).reduce((s, c) => s + c.amount, 0),
          ),
        });
      }
      case 'player.signed':
        return t('event.signed', {
          player: who(e.playerId),
          team: team(e.teamId),
          amount: money(e.contract.capHit),
          season: e.contract.expiresAfterSeason,
        });
      case 'prospect.signed':
        return t('event.prospectSigned', { player: who(e.playerId), team: team(e.teamId) });
      case 'prospect.released':
        return yours(e.teamIds) ? t('event.prospectReleased', { player: who(e.playerId) }) : null;
      case 'contract.extended':
        return t('event.extended', {
          player: who(e.playerId),
          team: team(e.teamId),
          amount: money(e.contract.capHit),
          season: e.contract.expiresAfterSeason,
        });
      case 'player.drafted':
        return e.pick === 1
          ? t('event.firstPick', {
              player: who(e.player.id),
              team: team(e.player.teamId ?? ''),
            })
          : null;
      case 'player.tradeRequested':
        return t('event.tradeRequested', {
          player: who(e.playerId),
          team: team(e.teamId),
        });
      case 'player.holdoutStarted':
        return t('event.holdoutStarted', {
          player: who(e.playerId),
          team: team(e.teamId),
        });
      case 'player.disputeStarted':
        return t('event.disputeStarted', { player: who(e.playerId) });
      case 'player.disputeEnded':
        return e.outcome === 'kept' || e.outcome === 'settled'
          ? t('event.disputeSettled', { player: who(e.playerId) })
          : null;
      case 'player.noTradeWaived':
        return t('event.noTradeWaived', { player: who(e.playerId) });
      case 'player.holdoutEnded':
        return t('event.holdoutEnded', { player: who(e.playerId) });
      case 'player.tradeRequestEnded':
        return e.withdrawn ? t('event.requestWithdrawn', { player: who(e.playerId) }) : null;
      case 'trade.offered':
        return t('event.tradeOffered', { team: team(e.offer.proposal.fromTeamId) });
      case 'freeAgency.opened':
        return t('event.freeAgencyOpened');
      case 'international.played':
        return t('event.internationalWon', {
          nation: t(`nation.${e.tournament.champion}` as MessageKey),
        });
      case 'season.phaseChanged':
        return t('event.phaseChanged', { phase: t(`phase.${e.to}`) });
      case 'news.posted':
        if (e.headline === 'event.awardWon')
          return t(e.headline, {
            ...e.params,
            award: t(`award.${e.params?.award}` as MessageKey),
          });
        if (e.headline === 'event.summerTraining')
          return t(e.headline, {
            ...e.params,
            focus: t(`training.${e.params?.focus}` as MessageKey),
          });
        if (e.headline === 'event.internationalGold' || e.headline === 'event.internationalSilver')
          return t(e.headline, {
            ...e.params,
            nation: t(`nation.${e.params?.nation}` as MessageKey),
          });
        if (e.headline === 'event.staffLeft' || e.headline === 'event.staffPoached')
          return t(e.headline, {
            ...e.params,
            dept: t(`team.staff.${e.params?.dept}` as MessageKey),
          });
        return isMessageKey(e.headline) ? t(e.headline, e.params) : e.headline;
      default:
        return null;
    }
  };

  const posts: Post[] = [];
  for (const event of data?.events ?? []) {
    const text = describe(event);
    if (!text) continue;
    const player =
      event.kind === 'player.drafted'
        ? event.player.id
        : 'playerId' in event
          ? (event.playerId ?? null)
          : null;
    posts.push({
      event,
      text,
      player,
      by: event.kind === 'news.posted' ? (event.by ?? null) : null,
      story: data?.stories[event.id] ?? null,
    });
  }
  return { posts, names, ages };
}
