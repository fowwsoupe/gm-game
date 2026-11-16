import type { LeagueEvent } from '@gm/shared';
import { useFeed, usePlayoffs, useTeams } from '@/lib/queries';
import { useT, type MessageKey } from '@/i18n';
import { Card } from '@/ui';

export function Home({
  hasLeague,
  teamCount,
  lastSim,
}: {
  hasLeague: boolean;
  teamCount: number;
  lastSim: string | null;
}) {
  const t = useT();
  if (!hasLeague) return <p className="text-muted">{t('home.empty')}</p>;
  return (
    <div className="grid max-w-4xl gap-4 md:grid-cols-2">
      <Card>
        <p>{t('home.teamsLoaded', { count: teamCount })}</p>
        {lastSim && <p className="mt-2 text-sm text-muted">{lastSim}</p>}
      </Card>
      <FeedCard />
      <PlayoffCard />
    </div>
  );
}

function FeedCard() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const { data: events = [] } = useFeed(8);
  const teamName = (id: string) => teams.find((x) => x.id === id)?.name ?? id;

  const describe = (e: LeagueEvent): string | null => {
    switch (e.kind) {
      case 'team.statusChanged':
        return t('event.statusChanged', { team: teamName(e.teamId), status: t(`status.${e.to}`) });
      case 'season.phaseChanged':
        return t('event.phaseChanged', { phase: t(`phase.${e.to}`) });
      case 'news.posted':
        if (
          e.headline === 'event.seriesWon' ||
          e.headline === 'event.championCrowned' ||
          e.headline === 'event.lotteryWon' ||
          e.headline === 'event.trade'
        )
          return t(e.headline, e.params);
        if (e.headline === 'event.awardWon')
          return t(e.headline, {
            ...e.params,
            award: t(`award.${e.params?.award}` as MessageKey),
          });
        return e.headline;
      default:
        return null;
    }
  };

  const lines = events.map((e) => ({ id: e.id, text: describe(e) })).filter((l) => l.text);
  return (
    <Card title={t('home.feedTitle')}>
      {lines.length === 0 ? (
        <p className="text-sm text-muted">{t('home.feedEmpty')}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {lines.map((l) => (
            <li key={l.id}>{l.text}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PlayoffCard() {
  const t = useT();
  const { data } = usePlayoffs();
  const { data: teams = [] } = useTeams();
  if (!data?.series.length) return null;
  const teamName = (id: string) => {
    const team = teams.find((x) => x.id === id);
    return team ? `${team.city} ${team.name}` : id;
  };
  return (
    <Card title={t('playoffs.title')}>
      {data.championTeamId && (
        <p className="mb-3 font-semibold text-accent">
          {t('playoffs.champion', { team: teamName(data.championTeamId) })}
        </p>
      )}
      <div className="space-y-3 text-sm">
        {data.series.map((series) => (
          <div key={series.id} className="border-b border-line pb-2">
            <p className="text-xs text-muted">{t('playoffs.round', { round: series.round })}</p>
            <p>
              {series.higherSeed}. {teamName(series.higherTeamId)} {series.higherWins}
            </p>
            <p>
              {series.lowerSeed}. {teamName(series.lowerTeamId)} {series.lowerWins}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
