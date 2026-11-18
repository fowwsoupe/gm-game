import { useState } from 'react';
import {
  STOP_CATEGORIES,
  type CardEffects,
  type Career,
  type LeagueEvent,
  type TeamId,
} from '@gm/shared';
import {
  useCapSheet,
  useDashboard,
  useDispatch,
  useFeed,
  usePlayoffs,
  usePulse,
  useStandings,
  useStatus,
  useTeams,
} from '@/lib/queries';
import { useUi } from '@/stores/ui';
import { money, moneyParams, pct, teamName } from '@/lib/format';
import { isMessageKey, useT, type MessageKey } from '@/i18n';
import { Button, Card, Face, StatRow, TeamSelect } from '@/ui';

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
  const { data: status } = useStatus();
  const mine = teams.find((x) => x.userControlled);
  if (!hasLeague) return <p className="text-muted">{t('home.empty')}</p>;
  return (
    <div className="grid max-w-5xl gap-4 md:grid-cols-2">
      {status?.career ? <CareerCard career={status.career} /> : <TeamPicker />}
      {mine ? <TeamStrip teamId={mine.id} /> : null}
      <SimBar />
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

/** Out of work: teams with a vacancy offer you the job, or you keep watching the league. */
function CareerCard({ career }: { career: Career }) {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const dispatch = useDispatch();
  return (
    <Card title={t('job.title')} className="md:col-span-2">
      <p className="text-sm">
        {t('job.fired', { team: teamName(teams, career.firedFrom), season: career.season })}
      </p>
      {career.offers.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t('job.none')}</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {career.offers.map((id) => (
            <li key={id} className="flex items-center justify-between gap-4">
              <span>{teamName(teams, id)}</span>
              <Button onClick={() => dispatch.mutate({ kind: 'career.takeJob', teamId: id })}>
                {t('job.take')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
      <TeamSelect
        teams={teams}
        value={mine?.id ?? ''}
        onChange={(id) => id && choose(id)}
        {...(!mine && { empty: t('home.noTeam') })}
      />
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
  const { data: status } = useStatus();
  // Odds only mean something before the playoffs are set.
  const inSeason = status?.phase === 'preseason' || status?.phase === 'regular';
  const odds = inSeason ? pulse.find((p) => p.teamId === teamId)?.playoffOdds : undefined;
  const space = sheet?.seasons[0]?.space;
  const opponent = teams.find((x) => x.id === home?.nextGame?.opponentId);
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
          <StatRow key={s.label} label={s.label} value={s.value} note={s.note} />
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
  const dispatch = useDispatch();
  const items = home?.todo ?? [];
  const cards = home?.ownerCards ?? [];
  return (
    <Card title={t('home.todoTitle')}>
      {cards.map((card) => (
        <div key={card.id} className="mb-3 space-y-2 text-sm">
          <p>{t(`owner.card.${card.kind}` as MessageKey, moneyParams(card.params))}</p>
          <div className="flex flex-wrap gap-2">
            {card.options.map((o) => (
              <Button
                key={o.key}
                onClick={() =>
                  dispatch.mutate({ kind: 'owner.answerCard', cardId: card.id, option: o.key })
                }
              >
                {t(`owner.option.${o.key}` as MessageKey)}
                {effectsText(t, o.effects)}
              </Button>
            ))}
          </div>
        </div>
      ))}
      {items.length === 0 && cards.length === 0 ? (
        <p className="text-sm text-good">{t('home.todoClear')}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((item) => {
            const params = moneyParams(item.params);
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
  const ages = data?.ages ?? {};
  const team = (id: string) => teamName(teams, id);
  const yours = (ids: readonly string[]) =>
    ids.some((id) => teams.find((x) => x.id === id)?.userControlled);

  const describe = (e: LeagueEvent): string | null => {
    switch (e.kind) {
      case 'team.statusChanged':
        return t('event.statusChanged', { team: team(e.teamId), status: t(`status.${e.to}`) });
      case 'draft.classAnnounced':
        return t('event.draftClass');
      case 'player.injured':
        // Short knocks elsewhere in the league are noise; yours and long ones are news.
        if (e.days < LONG_INJURY && !yours(e.teamIds)) return null;
        return t('event.injured', {
          player: names[e.playerId] ?? '',
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
          player: names[e.playerId] ?? '',
          team: team(e.teamId),
          amount: money(e.contract.capHit),
          season: e.contract.expiresAfterSeason,
        });
      case 'contract.extended':
        return t('event.extended', {
          player: names[e.playerId] ?? '',
          team: team(e.teamId),
          amount: money(e.contract.capHit),
          season: e.contract.expiresAfterSeason,
        });
      case 'player.drafted':
        return e.pick === 1
          ? t('event.firstPick', {
              player: names[e.player.id] ?? '',
              team: team(e.player.teamId ?? ''),
            })
          : null;
      case 'player.tradeRequested':
        return t('event.tradeRequested', {
          player: names[e.playerId] ?? '',
          team: team(e.teamId),
        });
      case 'player.holdoutStarted':
        return t('event.holdoutStarted', {
          player: names[e.playerId] ?? '',
          team: team(e.teamId),
        });
      case 'player.holdoutEnded':
        return t('event.holdoutEnded', { player: names[e.playerId] ?? '' });
      case 'player.tradeRequestEnded':
        return e.withdrawn
          ? t('event.requestWithdrawn', { player: names[e.playerId] ?? '' })
          : null;
      case 'trade.offered':
        return t('event.tradeOffered', { team: team(e.offer.proposal.fromTeamId) });
      case 'freeAgency.opened':
        return t('event.freeAgencyOpened');
      case 'season.phaseChanged':
        return t('event.phaseChanged', { phase: t(`phase.${e.to}`) });
      case 'news.posted':
        if (e.headline === 'event.awardWon')
          return t(e.headline, {
            ...e.params,
            award: t(`award.${e.params?.award}` as MessageKey),
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

  const lines = events
    .map((e) => ({
      id: e.id,
      text: describe(e),
      // The one player a line is about (news.posted carries none, so those get no face).
      player: e.kind === 'player.drafted' ? e.player.id : 'playerId' in e ? e.playerId : null,
    }))
    .filter((l) => l.text)
    .slice(0, 10);
  return (
    <Card title={t('home.feedTitle')}>
      {lines.length === 0 ? (
        <p className="text-sm text-muted">{t('home.feedEmpty')}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {lines.map((l) => (
            <li key={l.id}>
              {l.player && ages[l.player] !== undefined && (
                <Face seed={l.player} age={ages[l.player]!} size={22} />
              )}
              {l.text}
            </li>
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
  const team = (id: string) => teamName(teams, id);
  return (
    <Card title={t('playoffs.title')}>
      {data.championTeamId && (
        <p className="mb-3 font-semibold text-accent">
          {t('playoffs.champion', { team: team(data.championTeamId) })}
        </p>
      )}
      <div className="space-y-3 text-sm">
        {data.series.map((series) => (
          <div key={series.id} className="border-b border-line pb-2">
            <p className="text-xs text-muted">{t('playoffs.round', { round: series.round })}</p>
            <p>
              {series.higherSeed}. {team(series.higherTeamId)} {series.higherWins}
            </p>
            <p>
              {series.lowerSeed}. {team(series.lowerTeamId)} {series.lowerWins}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Pick a day on the season line (deadline and playoffs marked) and sim straight to it. */
function SimBar() {
  const t = useT();
  const { data: status } = useStatus();
  const { stopOn, toggleStop } = useUi();
  const dispatch = useDispatch();
  const [picked, setPicked] = useState<number | null>(null);
  if (!status || status.championTeamId || status.day >= status.playoffsEndDay) return null;
  const first = status.day + 1;
  const last = status.playoffsEndDay;
  const target = Math.min(last, Math.max(first, picked ?? first));
  const at = (day: number) => `${(Math.max(0, Math.min(1, day / last)) * 100).toFixed(1)}%`;
  const marks = [
    { day: status.tradeDeadlineDay, label: t('home.simBarDeadline') },
    { day: status.playoffsStartDay, label: t('home.simBarPlayoffs') },
  ].filter((m) => m.day > status.day);
  return (
    <Card title={t('home.simBarTitle')} className="md:col-span-2">
      <div className="relative mb-6 h-2 rounded-full bg-panel-2">
        <div
          className="absolute h-full rounded-full bg-[var(--team-primary)]"
          style={{ width: at(status.day) }}
        />
        {marks.map((m) => (
          <div key={m.label} className="absolute top-0 h-full" style={{ left: at(m.day) }}>
            <div className="h-full w-px bg-ink" />
            <div className="mt-1 -translate-x-1/2 whitespace-nowrap text-xs text-muted">
              {m.label}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          aria-label={t('home.simBarTitle')}
          min={first}
          max={last}
          value={target}
          onChange={(e) => setPicked(Number(e.target.value))}
          className="flex-1"
        />
        <Button
          variant="primary"
          disabled={dispatch.isPending}
          onClick={() => {
            dispatch.mutate({ kind: 'sim.advance', days: target - status.day, stopOn });
            setPicked(null);
          }}
        >
          {t('home.simBarGo', { day: target })}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>{t('home.stopOn')}</span>
        {STOP_CATEGORIES.map((c) => (
          <label key={c} className="flex items-center gap-1">
            <input type="checkbox" checked={stopOn.includes(c)} onChange={() => toggleStop(c)} />
            {t(`home.stopOn.${c}`)}
          </label>
        ))}
      </div>
    </Card>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** What an option does, in brackets after its label: " (confidence +3, budget +$5.2M)". */
function effectsText(t: ReturnType<typeof useT>, fx: CardEffects): string {
  const parts = [
    fx.confidence && t('owner.effect.confidence', { n: signed(fx.confidence) }),
    fx.payrollBudget && t('owner.effect.payrollBudget', { amount: `+${money(fx.payrollBudget)}` }),
    fx.cash && t('owner.effect.cash', { amount: money(fx.cash) }),
    fx.fanInterest && t('owner.effect.fanInterest', { n: signed(fx.fanInterest) }),
    fx.ticketPct !== undefined && t('owner.effect.ticketPct', { pct: signed(fx.ticketPct) }),
    fx.project && t('owner.effect.project', { seats: fx.project.seats }),
    fx.coach && t('owner.effect.coach', { name: fx.coach.hire.name }),
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}
