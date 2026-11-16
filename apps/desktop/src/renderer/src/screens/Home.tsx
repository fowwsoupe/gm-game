import type { LeagueEvent, TeamId } from '@gm/shared';
import {
  useCapSheet,
  useDashboard,
  useDispatch,
  useFeed,
  usePlayoffs,
  usePulse,
  useStandings,
  useTeams,
} from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { money } from '@/lib/format';
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
  const { data: teams = [] } = useTeams();
  const mine = teams.find((x) => x.userControlled);
  if (!hasLeague) return <p className="text-muted">{t('home.empty')}</p>;
  return (
    <div className="grid max-w-5xl gap-4 md:grid-cols-2">
      <TeamPicker />
      {mine ? <TeamStrip teamId={mine.id} /> : null}
      <Card>
        <p>{t('home.teamsLoaded', { count: teamCount })}</p>
        {lastSim && <p className="mt-2 text-sm text-muted">{lastSim}</p>}
      </Card>
      {mine && <TodoCard teamId={mine.id} />}
      <FeedCard />
      <PlayoffCard />
    </div>
  );
}

/** Pick the team you run: control moves to it (the old one goes back to its AI GM). */
function TeamPicker() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const dispatch = useDispatch();
  const mine = teams.find((x) => x.userControlled);
  const choose = (id: TeamId) => {
    if (mine?.id === id) return;
    dispatch.mutate({ kind: 'team.setUserControlled', teamId: id, userControlled: true });
    if (mine) {
      dispatch.mutate({ kind: 'team.setUserControlled', teamId: mine.id, userControlled: false });
    }
  };
  return (
    <label className="flex items-center gap-2 text-sm text-muted md:col-span-2">
      {t('home.yourTeam')}
      <select
        value={mine?.id ?? ''}
        onChange={(e) => choose(e.target.value as TeamId)}
        className="rounded border border-line bg-panel px-2 py-1 text-ink"
      >
        {!mine && <option value="">{t('home.noTeam')}</option>}
        {teams.map((x) => (
          <option key={x.id} value={x.id}>
            {x.city} {x.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Record, place, playoff odds, cap space and the next game, across the top. */
function TeamStrip({ teamId }: { teamId: TeamId }) {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const { data: rows = [] } = useStandings();
  const { data: pulse = [] } = usePulse();
  const { data: sheet } = useCapSheet(teamId);
  const { data: home } = useDashboard(teamId);
  const row = rows.find((r) => r.teamId === teamId);
  const odds = pulse.find((p) => p.teamId === teamId)?.playoffOdds;
  const space = sheet?.seasons[0]?.space;
  const opponent = teams.find((x) => x.id === home?.nextGame?.opponentId);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const stats: { label: string; value: string; note?: string }[] = [
    {
      label: t('home.record'),
      value: row ? `${row.w}-${row.l}-${row.otl}` : '–',
    },
    {
      label: t('home.place'),
      value: row ? t('home.placeValue', { n: rows.indexOf(row) + 1, of: rows.length }) : '–',
    },
    {
      label: t('home.odds'),
      value: odds === undefined ? '–' : pct(odds),
      ...(home?.raceNight && {
        note: t('home.raceNight', {
          win: pct(home.raceNight.ifWin),
          lose: pct(home.raceNight.ifLose),
        }),
      }),
    },
    { label: t('home.capSpace'), value: space === undefined ? '–' : money(space) },
    {
      label: t('home.nextGame'),
      value:
        home?.nextGame && opponent
          ? t(home.nextGame.home ? 'home.vs' : 'home.at', { team: opponent.abbreviation })
          : '–',
    },
  ];
  return (
    <Card className="md:col-span-2">
      <div className="grid grid-cols-5 gap-4">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-xs uppercase tracking-wider text-muted">{s.label}</div>
            <div className="tabular text-lg font-semibold">{s.value}</div>
            {s.note && <div className="tabular text-xs text-muted">{s.note}</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Decisions waiting on you. Clears to zero. */
function TodoCard({ teamId }: { teamId: TeamId }) {
  const t = useT();
  const setScreen = useUi((s) => s.setScreen);
  const { data: home } = useDashboard(teamId);
  const items = home?.todo ?? [];
  return (
    <Card title={t('home.todoTitle')}>
      {items.length === 0 ? (
        <p className="text-sm text-good">{t('home.todoClear')}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((item) => {
            const params = { ...item.params };
            if (typeof params.amount === 'number') params.amount = money(params.amount);
            return (
              <li key={item.code + JSON.stringify(params)}>
                <button
                  onClick={() => setScreen(item.screen)}
                  className="text-left hover:text-accent"
                >
                  {t(`todo.${item.code}` as MessageKey, params)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Matches the sim's "long injury" for stopping the sim. */
const LONG_INJURY = 14;

function FeedCard() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const { data } = useFeed(40);
  const events = data?.events ?? [];
  const names = data?.names ?? {};
  const teamName = (id: string) => teams.find((x) => x.id === id)?.name ?? id;
  const yours = (ids: readonly string[]) =>
    ids.some((id) => teams.find((x) => x.id === id)?.userControlled);

  const describe = (e: LeagueEvent): string | null => {
    switch (e.kind) {
      case 'team.statusChanged':
        return t('event.statusChanged', { team: teamName(e.teamId), status: t(`status.${e.to}`) });
      case 'draft.classAnnounced':
        return t('event.draftClass');
      case 'player.injured':
        // Short knocks elsewhere in the league are noise; yours and long ones are news.
        if (e.days < LONG_INJURY && !yours(e.teamIds)) return null;
        return t('event.injured', {
          player: names[e.playerId] ?? '',
          team: teamName(e.teamIds[0] ?? ''),
          days: e.days,
        });
      case 'player.signed':
        return t('event.signed', {
          player: names[e.playerId] ?? '',
          team: teamName(e.teamId),
          amount: money(e.contract.capHit),
          season: e.contract.expiresAfterSeason,
        });
      case 'contract.extended':
        return t('event.extended', {
          player: names[e.playerId] ?? '',
          team: teamName(e.teamId),
          amount: money(e.contract.capHit),
          season: e.contract.expiresAfterSeason,
        });
      case 'player.drafted':
        return e.pick === 1
          ? t('event.firstPick', {
              player: names[e.player.id] ?? '',
              team: teamName(e.player.teamId ?? ''),
            })
          : null;
      case 'trade.offered':
        return t('event.tradeOffered', { team: teamName(e.offer.proposal.fromTeamId) });
      case 'freeAgency.opened':
        return t('event.freeAgencyOpened');
      case 'season.phaseChanged':
        return t('event.phaseChanged', { phase: t(`phase.${e.to}`) });
      case 'news.posted':
        if (
          e.headline === 'event.seriesWon' ||
          e.headline === 'event.championCrowned' ||
          e.headline === 'event.lotteryWon' ||
          e.headline === 'event.trade' ||
          e.headline === 'event.winStreak' ||
          e.headline === 'event.losingStreak' ||
          e.headline === 'event.hatTrick' ||
          e.headline === 'event.shutout'
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

  const lines = events
    .map((e) => ({ id: e.id, text: describe(e) }))
    .filter((l) => l.text)
    .slice(0, 10);
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
