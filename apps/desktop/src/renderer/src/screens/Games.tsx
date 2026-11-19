import { useEffect, useMemo, useState } from 'react';
import type { GameDetail, HockeyBoxScore, HockeyBoxSide, Team, TeamId } from '@gm/shared';
import { useExhibition, useGames, useOpenGame, useTeams, useMine } from '@/lib/queries';
import { statValue, teamAbbr, teamName } from '@/lib/format';
import { useT } from '@/i18n';
import { Button, Card, TeamLink, TeamSelect, SectionHeader, Td, Th } from '@/ui';

const SPEEDS = [60, 180, 600] as const;
/** Time left in the period; overtime is one 20:00 period at a time in the playoffs, shorter otherwise. */
const clockText = (sec: number, ot: number) => {
  const left = Math.max(0, sec < 3600 ? 1200 - (sec % 1200) : ot - ((sec - 3600) % ot));
  return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
};

export function Games() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const mine = useMine()?.id;
  const [filter, setFilter] = useState<TeamId | undefined>();
  const [home, setHome] = useState<TeamId | ''>('');
  const [away, setAway] = useState<TeamId | ''>('');
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: games = [] } = useGames(filter ?? mine);
  const open = useOpenGame();
  const exhibition = useExhibition();

  if (teams.length === 0) return <p className="text-muted">{t('common.noLeague')}</p>;
  const play = () => {
    if (!home || !away || home === away) return setError(t('games.pickTeams'));
    setError(null);
    exhibition.mutate(
      { homeTeamId: home, awayTeamId: away, seed: Math.floor(Math.random() * 2 ** 31) },
      { onSuccess: setDetail },
    );
  };
  const teamSelect = (value: TeamId | '', set: (v: TeamId | '') => void, label: string) => (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <TeamSelect teams={teams} value={value} onChange={set} empty="" />
    </label>
  );

  return (
    <div className="grid max-w-6xl gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="space-y-4">
        <Card title={t('games.matchupTitle')}>
          <div className="space-y-3">
            {teamSelect(home, setHome, t('games.home'))}
            {teamSelect(away, setAway, t('games.away'))}
            <Button variant="primary" disabled={exhibition.isPending} onClick={play}>
              {detail ? t('games.replay') : t('games.play')}
            </Button>
            {error && <p className="text-sm text-bad">{error}</p>}
          </div>
        </Card>
        <Card title={t('games.recentTitle')}>
          <TeamSelect
            teams={teams}
            value={filter ?? ''}
            onChange={(id) => setFilter(id || undefined)}
            empty={mine ? teamName(teams, mine) : t('games.allTeams')}
            className="mb-3 w-full"
          />
          {games.length === 0 ? (
            <p className="text-sm text-muted">{t('games.recentEmpty')}</p>
          ) : (
            <ul className="tabular max-h-96 space-y-1 overflow-auto text-sm">
              {games.map((g) => (
                <li key={g.id}>
                  <button
                    onClick={() => open.mutate(g.id, { onSuccess: setDetail })}
                    className={`flex w-full justify-between rounded px-2 py-1 text-left hover:bg-panel-2 ${detail?.result.id === g.id ? 'bg-line' : ''}`}
                  >
                    <span>
                      {teamAbbr(teams, g.awayTeamId)} {g.awayScore} @{' '}
                      {teamAbbr(teams, g.homeTeamId)} {g.homeScore}
                    </span>
                    <span className="text-muted">
                      {g.shootout ? t('games.so') : g.overtime ? t('games.ot') : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {detail ? (
        <Replay key={detail.result.id} detail={detail} teams={teams} />
      ) : (
        <p className="text-muted">{t('games.noGame')}</p>
      )}
    </div>
  );
}

function Replay({ detail, teams }: { detail: GameDetail; teams: Team[] }) {
  const t = useT();
  const { result, names } = detail;
  const box = result.box as HockeyBoxScore | undefined;
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(SPEEDS[1]);
  const end = useMemo(
    () => (box ? Math.max(3600, Math.ceil(((box.shots.at(-1)?.[0] ?? 0) + 5) / 60) * 60) : 3600),
    [box],
  );
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setClock((c) => (c + speed * 0.1 >= end ? (setPlaying(false), end) : c + speed * 0.1)),
      100,
    );
    return () => clearInterval(timer);
  }, [playing, speed, end]);
  if (!box) return null;

  const sides = [box.home, box.away] as const;
  const ids = [result.homeTeamId, result.awayTeamId] as const;
  const nameOf = (side: 0 | 1, k: number) =>
    names[sides[side].skaters[k]?.id ?? ''] ?? sides[side].skaters[k]?.id ?? '';
  const shown = box.shots.filter((s) => s[0] <= clock);
  const goals = [0, 1].map((n) => shown.filter((s) => s[1] === n && s[5] === 1).length);
  const finished = clock >= end;
  const score = finished ? [result.homeScore, result.awayScore] : goals;
  const period = clock < 3600 ? Math.min(3, Math.floor(clock / 1200) + 1) : 0;

  // The feed: goals and penalties up to the clock, newest first.
  type Line = { at: number; text: string };
  const lines: Line[] = [
    ...box.shots
      .filter((s) => s[5] === 1 && s[0] <= clock)
      .map((s) => {
        const side = s[1];
        const helpers = [s[6], s[7]].filter((k) => k >= 0).map((k) => nameOf(side, k));
        return {
          at: s[0],
          text:
            t('games.goal', {
              team: teamAbbr(teams, ids[side]),
              player: nameOf(side, s[4]),
              assists: helpers.length ? ` (${helpers.join(', ')})` : '',
            }) + (s[8] === 1 ? t('games.goalPp') : ''),
        };
      }),
    ...box.penalties
      .filter((p) => p[0] <= clock)
      .map((p) => ({
        at: p[0],
        text: t('games.penalty', {
          team: teamAbbr(teams, ids[p[1]]),
          player: nameOf(p[1], p[2]),
        }),
      })),
  ].sort((a, b) => b.at - a.at);
  if (finished && result.stats.shootout === 1) {
    const winner = result.homeScore > result.awayScore ? ids[0] : ids[1];
    lines.unshift({ at: end, text: t('games.shootoutWon', { team: teamName(teams, winner) }) });
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="tabular flex items-center justify-between gap-4">
          <Side
            id={ids[1]}
            name={teamName(teams, ids[1])}
            score={score[1]!}
            label={t('games.away')}
          />
          <div className="text-center text-sm text-muted">
            {finished ? (
              <span className="text-ink">
                {t('games.final')}
                {result.stats.shootout === 1
                  ? ` / ${t('games.so')}`
                  : result.overtime
                    ? ` / ${t('games.ot')}`
                    : ''}
              </span>
            ) : (
              <>
                <div className="text-lg text-ink">{clockText(clock, detail.overtimeSeconds)}</div>
                {period > 0 ? t('games.period', { n: period }) : t('games.overtime')}
              </>
            )}
          </div>
          <Side
            id={ids[0]}
            name={teamName(teams, ids[0])}
            score={score[0]!}
            label={t('games.home')}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => setPlaying(!playing)} disabled={finished}>
            {playing ? t('games.pause') : t('games.resume')}
          </Button>
          <Button
            onClick={() => {
              setClock(0);
              setPlaying(true);
            }}
          >
            {t('games.restart')}
          </Button>
          <Button
            onClick={() => {
              setClock(end);
              setPlaying(false);
            }}
            disabled={finished}
          >
            {t('games.skip')}
          </Button>
          <span className="ml-2 text-xs text-muted">{t('games.speed')}</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`rounded px-2 py-1 text-xs ${speed === s ? 'bg-line text-ink' : 'text-muted hover:text-ink'}`}
            >
              {s}×
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t('games.shotMap')}>
          <ShotMap shots={shown} />
          <p className="tabular mt-2 text-xs text-muted">
            {t('games.shots')}: {teamAbbr(teams, ids[1])} {shown.filter((s) => s[1] === 1).length} ·{' '}
            {teamAbbr(teams, ids[0])} {shown.filter((s) => s[1] === 0).length}
          </p>
        </Card>
        <Card title={t('games.feedTitle')}>
          {lines.length === 0 ? (
            <p className="text-sm text-muted">{t('games.feedEmpty')}</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-auto text-sm">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="tabular w-12 shrink-0 text-muted">
                    {l.at < 3600
                      ? t('games.periodShort', { n: Math.floor(l.at / 1200) + 1 })
                      : t('games.ot')}{' '}
                    {l.at < 3600 || l.at < end ? clockText(l.at, detail.overtimeSeconds) : ''}
                  </span>
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t('games.boxTitle')}>
        <div className="grid gap-6 xl:grid-cols-2">
          {([1, 0] as const).map((n) => (
            <BoxSide key={n} title={teamName(teams, ids[n])} side={sides[n]} names={names} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function Side({
  id,
  name,
  score,
  label,
}: {
  id: string;
  name: string;
  score: number;
  label: string;
}) {
  return (
    <div className="flex-1 text-center">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm">
        <TeamLink teamId={id}>{name}</TeamLink>
      </div>
      <div className="text-4xl font-semibold">{score}</div>
    </div>
  );
}

/** The offensive zone: net at the left, goal line at x = 0. Home shots in accent, away in grey. */
function ShotMap({ shots }: { shots: HockeyBoxScore['shots'] }) {
  return (
    <svg viewBox="-4 -44 80 88" className="w-full rounded bg-panel-2" role="img">
      <rect
        x="0"
        y="-42.5"
        width="72"
        height="85"
        fill="none"
        stroke="currentColor"
        opacity="0.2"
      />
      <line x1="64" y1="-42.5" x2="64" y2="42.5" stroke="#4a6fa5" strokeWidth="1" />
      <line x1="0" y1="-42.5" x2="0" y2="42.5" stroke="#b33" strokeWidth="0.6" opacity="0.7" />
      <rect x="-3.5" y="-3" width="3.5" height="6" fill="none" stroke="#b33" strokeWidth="0.5" />
      <path d="M 0 -6 A 6 6 0 0 1 0 6 Z" fill="#4a6fa544" stroke="none" />
      {[-22, 22].map((y) => (
        <g key={y} opacity="0.3">
          <circle cx="20" cy={y} r="15" fill="none" stroke="#b33" strokeWidth="0.5" />
          <circle cx="20" cy={y} r="1" fill="#b33" />
        </g>
      ))}
      {shots.map((s, i) => (
        <circle
          key={i}
          cx={s[2]}
          cy={s[3]}
          r={s[5] === 1 ? 2.4 : 1.3}
          fill={s[1] === 0 ? 'var(--team-primary)' : '#8a8f98'}
          stroke={s[5] === 1 ? 'currentColor' : 'none'}
          strokeWidth="0.5"
          opacity={s[5] === 1 ? 1 : 0.65}
        />
      ))}
    </svg>
  );
}

function BoxSide({
  title,
  side,
  names,
}: {
  title: string;
  side: HockeyBoxSide;
  names: Record<string, string>;
}) {
  const t = useT();
  const rows = side.skaters
    .filter((s) => s.toi > 0)
    .sort((a, b) => b.toi - a.toi || a.id.localeCompare(b.id));
  const goalies = [side.goalie, ...(side.relief ? [side.relief] : [])].filter((g) => g.id);
  return (
    <div>
      <SectionHeader>{title}</SectionHeader>
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="border-b border-line text-right text-muted">
            <Th left>{t('roster.player')}</Th>
            {(['toi', 'goals', 'assists', 'points', 'plusMinus', 'shots', 'pim'] as const).map(
              (k) => (
                <Th key={k}>{t(`stat.${k}`)}</Th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="border-b border-line/40 text-right">
              <Td left>{names[s.id] ?? s.id}</Td>
              <Td>{s.toi.toFixed(1)}</Td>
              <Td>{s.goals}</Td>
              <Td>{s.assists}</Td>
              <Td>{s.goals + s.assists}</Td>
              <Td>{s.plusMinus}</Td>
              <Td>{s.shots}</Td>
              <Td>{s.pim}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="tabular mt-3 w-full text-sm">
        <thead>
          <tr className="border-b border-line text-right text-muted">
            <Th left>{t('games.goalies')}</Th>
            <Th>{t('stat.toi')}</Th>
            <Th>{t('games.shotsAgainst')}</Th>
            <Th>{t('games.saves')}</Th>
            <Th>{t('stat.savePct')}</Th>
          </tr>
        </thead>
        <tbody>
          {goalies.map((g, i) => (
            <tr key={g.id} className="border-b border-line/40 text-right">
              <Td left>
                {names[g.id] ?? g.id} {i > 0 ? t('games.relief') : ''}
              </Td>
              <Td>{g.toi.toFixed(1)}</Td>
              <Td>{g.shotsAgainst}</Td>
              <Td>{g.saves}</Td>
              <Td>{g.shotsAgainst ? statValue('savePct', g.saves / g.shotsAgainst) : '—'}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
