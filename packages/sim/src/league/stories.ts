import type { LeagueEvent } from '@gm/shared';
import { pairKey } from '../core';

/** Posts that carry on a player's open story without ending it: his word, or his GM's. */
const BEATS = new Set([
  'event.holdoutStands',
  'event.holdoutShopped',
  'event.requestStands',
  'event.noTradeRefused',
]);

/** Team stories a post opens (by headline), and the posts that carry each one on that season. */
const TEAM_STORIES: Record<string, { story: string; beats: string[] }> = {
  'event.fireSale': { story: 'fireSale', beats: [] }, // its trades join it (below)
  'event.ownerFrustrated': { story: 'hotSeat', beats: ['event.coachFired', 'event.gmFired'] },
  'event.madeRoom': { story: 'room', beats: ['event.madeRoom', 'event.lostFreeAgent'] },
};

/**
 * Storylines (docs/research/2026-11-league-news.md): which events in a stretch of the log belong
 * to one story, as `{ eventId: storyKey }`. Worked out on read, from the events alone, so old
 * saves thread their past too; a story opened before the stretch starts shows only what is in it.
 * - A player's story opens on a holdout, a trade request or a breakout, takes his and his GM's
 *   word, and ends with the holdout or request, an extension, his deal running out or a trade.
 * - A team's story (a fire sale, an owner losing patience, a contender clearing room) runs that
 *   season: the fire sale's trades, the coach or GM fired, the signing the room was made for.
 * - A rivalry is every "rivalry renewed" between the same two teams.
 */
export function storyOf(events: readonly LeagueEvent[]): Record<string, string> {
  const out: Record<string, string> = {};
  const players = new Map<string, string>(); // player id → his open story
  const teams = new Map<string, { key: string; season: number }>(); // `story:team` → open story
  let trade: Extract<LeagueEvent, { kind: 'trade.completed' }> | undefined;
  const team = (story: string, teamId: string | undefined, season: number) => {
    const open = teams.get(`${story}:${teamId}`);
    return open?.season === season ? open.key : undefined;
  };
  const player = (id: string | undefined, close: boolean) => {
    const key = id === undefined ? undefined : players.get(id);
    if (key && close) players.delete(id!);
    return key;
  };

  for (const e of [...events].sort((a, b) => a.id.localeCompare(b.id))) {
    const { season } = e.date;
    let key: string | undefined;
    switch (e.kind) {
      case 'player.holdoutStarted':
        key = `holdout:${e.playerId}:${season}`;
        players.set(e.playerId, key);
        break;
      case 'player.tradeRequested':
        key = `request:${e.playerId}`;
        players.set(e.playerId, key);
        break;
      case 'player.noTradeWaived':
        key = player(e.playerId, false);
        break;
      case 'player.holdoutEnded':
      case 'player.tradeRequestEnded':
      case 'contract.extended':
      case 'contract.expired':
        key = player(e.playerId, true);
        break;
      case 'player.signed':
        key = team('room', e.teamId, season);
        teams.delete(`room:${e.teamId}`);
        break;
      case 'trade.completed':
        trade = e; // its headline comes next
        break;
      case 'news.posted': {
        const teamId = e.teamIds[0];
        const opens = TEAM_STORIES[e.headline];
        if (
          e.playerId &&
          (e.headline === 'event.breakout' || e.headline === 'event.breakoutPace')
        ) {
          key = `breakout:${e.playerId}:${season}`;
          players.set(e.playerId, key);
        } else if (BEATS.has(e.headline)) {
          key = player(e.playerId, false);
        } else if (e.headline === 'event.rivalry') {
          key = `rivals:${pairKey(e.teamIds[0]!, e.teamIds[1]!)}`;
        } else if (e.headline === 'event.trade' && trade) {
          // The players' own stories first, then a fire sale the trade sent one of them out of.
          const moved = [...trade.give, ...trade.get];
          key = moved.map((id) => player(id, true)).find(Boolean);
          key ??=
            (trade.give.length ? team('fireSale', trade.fromTeamId, season) : undefined) ??
            (trade.get.length ? team('fireSale', trade.toTeamId, season) : undefined);
          trade = undefined;
        }
        for (const { story, beats } of Object.values(TEAM_STORIES)) {
          if (beats.includes(e.headline)) key ??= team(story, teamId, season);
        }
        if (!key && opens) {
          key = `${opens.story}:${teamId}:${season}`;
          teams.set(`${opens.story}:${teamId}`, { key, season });
        }
        break;
      }
      default:
        break;
    }
    if (key) out[e.id] = key;
  }
  return out;
}
