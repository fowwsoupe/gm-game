import { useState } from 'react';
import type { LeagueEvent } from '@gm/shared';
import {
  useDispatch,
  useFeed,
  useNewLeague,
  useNewLeagueFromRoster,
  usePlayoffs,
  useSteam,
  useTeams,
} from '@/lib/queries';
import { useUi, type Screen } from '@/stores/ui';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card } from '@/ui';
import { Standings } from '@/screens/Standings';
import { History } from '@/screens/History';
import { Leaders } from '@/screens/Leaders';

const NAV: { id: Screen; label: MessageKey }[] = [
  { id: 'home', label: 'nav.home' },
  { id: 'standings', label: 'nav.standings' },
  { id: 'roster', label: 'nav.roster' },
  { id: 'leaders', label: 'nav.leaders' },
  { id: 'history', label: 'nav.history' },
];

export function App() {
  const t = useT();
  const { screen, setScreen, locale, setLocale } = useUi();
  const { data: steam } = useSteam();
  const { data: teams = [], isError } = useTeams();
  const newLeague = useNewLeague();
  const fromRoster = useNewLeagueFromRoster();
  const dispatch = useDispatch();
  const [lastSim, setLastSim] = useState<string | null>(null);
  const { data: playoffs } = usePlayoffs();
  const hasLeague = !isError && teams.length > 0;

  const sim = (days: number, stopOn: 'never' | 'major' = 'never') =>
    dispatch.mutate(
      { kind: 'sim.advance', days, stopOn },
      {
        onSuccess: (res) => {
          if (!res.ok) return setLastSim(res.error.message);
          const games = res.events.filter((e) => e.kind === 'game.final').length;
          const simmed = res.events.filter((e) => e.kind === 'clock.advanced').length;
          setLastSim(t('home.simmed', { days: simmed, games }));
        },
      },
    );

  return (
    <div className="flex h-full">
      <aside className="flex w-56 flex-col gap-1 border-r border-line bg-panel p-3">
        <div className="mb-4 px-2 text-lg font-semibold">{t('app.name')}</div>
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setScreen(n.id)}
            className={`rounded px-2 py-1.5 text-left text-sm ${screen === n.id ? 'bg-line text-ink' : 'text-muted hover:text-ink'}`}
          >
            {t(n.label)}
          </button>
        ))}
        <div className="mt-auto flex items-center justify-between px-2 text-xs text-muted">
          <span>
            {steam?.enabled ? t('steam.on', { name: steam.playerName ?? '' }) : t('steam.off')}
          </span>
          <button
            onClick={() => setLocale(locale === 'en' ? 'fr' : 'en')}
            className="uppercase hover:text-ink"
          >
            {locale === 'en' ? 'fr' : 'en'}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        <div className="mb-6 flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => newLeague.mutate(Math.floor(Math.random() * 1e9))}
          >
            {t('actions.newLeague')}
          </Button>
          <Button
            onClick={() =>
              fromRoster.mutate(Math.floor(Math.random() * 1e9), {
                onSuccess: (res) => {
                  if (res.ok === 'canceled') return;
                  setLastSim(
                    res.ok
                      ? t('home.teamsLoaded', { count: res.teams.length })
                      : `${t('roster.loadFailed')} ${res.errors.slice(0, 3).join('; ')}`,
                  );
                },
              })
            }
          >
            {t('actions.loadRoster')}
          </Button>
          <Button disabled={!hasLeague || dispatch.isPending} onClick={() => sim(1)}>
            {t('actions.simDay')}
          </Button>
          <Button disabled={!hasLeague || dispatch.isPending} onClick={() => sim(7)}>
            {t('actions.simWeek')}
          </Button>
          <Button disabled={!hasLeague || dispatch.isPending} onClick={() => sim(400, 'major')}>
            {t('actions.simToNext')}
          </Button>
          <Button
            disabled={!playoffs?.championTeamId || dispatch.isPending}
            onClick={() =>
              dispatch.mutate(
                { kind: 'season.rollover' },
                { onSuccess: (res) => !res.ok && setLastSim(res.error.message) },
              )
            }
          >
            {t('actions.nextSeason')}
          </Button>
        </div>

        {screen === 'home' && (
          <Home hasLeague={hasLeague} teamCount={teams.length} lastSim={lastSim} />
        )}
        {screen === 'standings' && <Standings />}
        {screen === 'leaders' && <Leaders />}
        {screen === 'history' && <History />}
        {screen === 'roster' && <p className="text-muted">{t('roster.placeholder')}</p>}
      </main>
    </div>
  );
}

function Home({
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
          e.headline === 'event.lotteryWon'
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
