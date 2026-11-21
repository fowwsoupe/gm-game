import { useEffect, useState } from 'react';
import { CommandK } from '@/CommandK';
import { Walkthrough, walkthroughSeen } from '@/Walkthrough';
import {
  useDispatch,
  useMine,
  useNewLeague,
  useNewLeagueFromRoster,
  useOnline,
  usePlayoffs,
  usePush,
  useSessionCall,
  useStatus,
  useSteam,
  useTeams,
} from '@/lib/queries';
import type { StopCategory } from '@gm/shared';
import { useUi, type Screen } from '@/stores/ui';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card, TeamSelect, TrophyLift } from '@/ui';
import { teamName } from '@/lib/format';
import { Standings } from '@/screens/Standings';
import { History } from '@/screens/History';
import { Leaders } from '@/screens/Leaders';
import { Cap } from '@/screens/Cap';
import { Games } from '@/screens/Games';
import { Home } from '@/screens/Home';
import { News } from '@/screens/News';
import { Roster } from '@/screens/Roster';
import { Trades } from '@/screens/Trades';
import { Lines } from '@/screens/Lines';
import { Draft } from '@/screens/Draft';
import { TeamPage } from '@/screens/TeamPage';
import { Owner } from '@/screens/Owner';
import { FrontOffice } from '@/screens/FrontOffice';
import { Player } from '@/screens/Player';
import { Online } from '@/screens/Online';

const NAV: { id: Screen; label: MessageKey }[] = [
  { id: 'home', label: 'nav.home' },
  { id: 'news', label: 'nav.news' },
  { id: 'standings', label: 'nav.standings' },
  { id: 'roster', label: 'nav.roster' },
  { id: 'freeAgency', label: 'nav.freeAgency' },
  { id: 'lines', label: 'nav.lines' },
  { id: 'trades', label: 'nav.trades' },
  { id: 'draft', label: 'nav.draft' },
  { id: 'games', label: 'nav.games' },
  { id: 'cap', label: 'nav.cap' },
  { id: 'owner', label: 'nav.owner' },
  { id: 'frontOffice', label: 'nav.frontOffice' },
  { id: 'leaders', label: 'nav.leaders' },
  { id: 'history', label: 'nav.history' },
  { id: 'online', label: 'nav.online' },
];

export function App() {
  const t = useT();
  const { screen, setScreen, locale, setLocale, handOver, curtain, liftCurtain } = useUi();
  const { data: steam } = useSteam();
  const { data: teams = [], isError } = useTeams();
  const humans = teams.filter((x) => x.userControlled);
  const mine = useMine();
  const nextGm = humans[(humans.findIndex((x) => x.id === mine?.id) + 1) % humans.length];
  const newLeague = useNewLeague();
  const fromRoster = useNewLeagueFromRoster();
  const dispatch = useDispatch();
  const [lastSim, setLastSim] = useState<string | null>(null);
  const { data: playoffs } = usePlayoffs();
  const { data: status } = useStatus();
  const hasLeague = !isError && teams.length > 0;
  // A hosted league: a guest has one team and no hot seat, and the clock is the host's to give.
  usePush();
  const { session, me, guest, open, clock } = useOnline();
  const call = useSessionCall();
  // A session that ended by itself (kicked, the host gone, an error): the Online screen says why.
  const ended = session?.role === 'none' && session.ended;
  useEffect(() => {
    if (ended) setScreen('online');
  }, [ended, setScreen]);
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

  const sim = (days: number, stopOn: 'never' | readonly StopCategory[] = 'never') =>
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
      {curtain && mine && humans.length > 1 && !guest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg">
          <Card title={t('home.handOverTitle')}>
            <p className="mb-4 text-sm text-muted">
              {t('home.handOver', { team: teamName(teams, mine.id) })}
            </p>
            <Button variant="primary" onClick={liftCurtain}>
              {t('home.takeSeat', { team: mine.abbreviation })}
            </Button>
          </Card>
        </div>
      )}
      <aside className="flex w-56 flex-col gap-1 border-r border-line bg-panel p-3">
        <div className="mb-4 px-2 text-lg font-semibold">{t('app.name')}</div>
        {humans.length > 1 && !guest && (
          <label className="mb-3 flex flex-col gap-1 px-2 text-xs text-muted">
            {t('home.seat')}
            <TeamSelect
              teams={humans}
              value={mine?.id ?? ''}
              onChange={(id) => id && id !== mine?.id && handOver(id)}
            />
            {nextGm && (
              <Button onClick={() => handOver(nextGm.id)}>
                {t('home.nextGm', { team: nextGm.abbreviation })}
              </Button>
            )}
          </label>
        )}
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
          {!open && (
            <>
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
            </>
          )}
          {clock && (
            <>
              <Button disabled={!hasLeague || dispatch.isPending} onClick={() => sim(1)}>
                {t('actions.simDay')}
              </Button>
              <Button disabled={!hasLeague || dispatch.isPending} onClick={() => sim(7)}>
                {t('actions.simWeek')}
              </Button>
              <Button
                disabled={!hasLeague || dispatch.isPending}
                onClick={() => sim(400, status?.stopOn)}
              >
                {t('actions.simToNext')}
              </Button>
              {status &&
                [
                  { to: 0, label: t('actions.simToOpeningNight') },
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
              {status?.championTeamId && !status.freeAgencyOpen && !status.draftLive && (
                <Button
                  disabled={dispatch.isPending}
                  onClick={() =>
                    dispatch.mutate(
                      { kind: 'offseason.startDraft' },
                      {
                        onSuccess: (res) =>
                          res.ok ? setScreen('draft') : setLastSim(res.error.message),
                      },
                    )
                  }
                >
                  {t('actions.startDraft')}
                </Button>
              )}
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
            </>
          )}
          {me?.teamId && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={me.ready}
                disabled={call.isPending}
                onChange={() => call.mutate((s) => s.ready({ on: !me.ready }))}
              />
              {t('online.imReady')}
            </label>
          )}
        </div>
        {session?.role === 'guest' && session.reconnecting && (
          <p className="mb-4 text-sm text-bad">{t('online.reconnecting')}</p>
        )}

        <TrophyLift />
        {screen === 'home' && (
          <Home hasLeague={hasLeague} teamCount={teams.length} lastSim={lastSim} />
        )}
        {screen === 'news' && <News />}
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
        {screen === 'owner' && <Owner />}
        {screen === 'frontOffice' && <FrontOffice />}
        {screen === 'player' && <Player />}
        {screen === 'online' && <Online />}
      </main>
    </div>
  );
}
