import { useEffect, useState } from 'react';
import { CommandK } from '@/CommandK';
import { Walkthrough, walkthroughSeen } from '@/Walkthrough';
import {
  useDispatch,
  useNewLeague,
  useNewLeagueFromRoster,
  usePlayoffs,
  useStatus,
  useSteam,
  useTeams,
} from '@/lib/queries';
import { useUi, type Screen } from '@/stores/ui';
import { useT, type MessageKey } from '@/i18n';
import { Button } from '@/ui';
import { Standings } from '@/screens/Standings';
import { History } from '@/screens/History';
import { Leaders } from '@/screens/Leaders';
import { Cap } from '@/screens/Cap';
import { Games } from '@/screens/Games';
import { Home } from '@/screens/Home';
import { Roster } from '@/screens/Roster';
import { Trades } from '@/screens/Trades';
import { Lines } from '@/screens/Lines';
import { Draft } from '@/screens/Draft';
import { TeamPage } from '@/screens/TeamPage';

const NAV: { id: Screen; label: MessageKey }[] = [
  { id: 'home', label: 'nav.home' },
  { id: 'standings', label: 'nav.standings' },
  { id: 'roster', label: 'nav.roster' },
  { id: 'freeAgency', label: 'nav.freeAgency' },
  { id: 'lines', label: 'nav.lines' },
  { id: 'trades', label: 'nav.trades' },
  { id: 'draft', label: 'nav.draft' },
  { id: 'games', label: 'nav.games' },
  { id: 'cap', label: 'nav.cap' },
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
  const { data: status } = useStatus();
  const hasLeague = !isError && teams.length > 0;
  const [searching, setSearching] = useState(false);
  const [tour, setTour] = useState(false);
  const [tourChecked, setTourChecked] = useState(false);
  if (hasLeague && !tourChecked) {
    setTourChecked(true);
    if (!walkthroughSeen()) setTour(true);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      {tour && <Walkthrough onClose={() => setTour(false)} />}
      {searching && <CommandK screens={NAV} onClose={() => setSearching(false)} />}
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
          <button onClick={() => setTour(true)} className="hover:text-ink">
            {t('walkthrough.help')}
          </button>
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
            onClick={() => {
              if (!hasLeague || window.confirm(t('actions.confirmReplace')))
                newLeague.mutate(Math.floor(Math.random() * 1e9));
            }}
          >
            {t('actions.newLeague')}
          </Button>
          <Button
            onClick={() =>
              (!hasLeague || window.confirm(t('actions.confirmReplace'))) &&
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
          {status &&
            [
              { to: status.tradeDeadlineDay, label: t('actions.simToDeadline') },
              { to: status.playoffsStartDay, label: t('actions.simToPlayoffs') },
              { to: status.playoffsEndDay, label: t('actions.simToSummer') },
            ]
              .filter((d) => d.to > status.day && !status.championTeamId)
              .slice(0, 1)
              .map((d) => (
                <Button
                  key={d.label}
                  disabled={dispatch.isPending}
                  onClick={() => sim(Math.min(400, d.to - status.day))}
                >
                  {d.label}
                </Button>
              ))}
          {status?.championTeamId && !status.freeAgencyOpen && (
            <Button
              disabled={dispatch.isPending}
              onClick={() =>
                dispatch.mutate(
                  { kind: 'offseason.openFreeAgency' },
                  {
                    onSuccess: (res) =>
                      setLastSim(res.ok ? t('home.freeAgencyOpen') : res.error.message),
                  },
                )
              }
            >
              {t('actions.openFreeAgency')}
            </Button>
          )}
          {status?.freeAgencyOpen && (
            <Button
              disabled={dispatch.isPending}
              onClick={() =>
                dispatch.mutate(
                  { kind: 'freeAgency.advanceDay' },
                  { onSuccess: (res) => !res.ok && setLastSim(res.error.message) },
                )
              }
            >
              {t('actions.freeAgencyDay')}
            </Button>
          )}
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
        {screen === 'games' && <Games />}
        {screen === 'cap' && <Cap />}
        {screen === 'leaders' && <Leaders />}
        {screen === 'history' && <History />}
        {screen === 'roster' && <Roster />}
        {screen === 'freeAgency' && <Roster freeAgents />}
        {screen === 'lines' && <Lines />}
        {screen === 'trades' && <Trades />}
        {screen === 'draft' && <Draft />}
        {screen === 'team' && <TeamPage />}
      </main>
    </div>
  );
}
