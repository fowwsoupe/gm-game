import { useState } from 'react';
import type { GmApi, SessionResult, SessionStatus, Team } from '@gm/shared';
import { useSession, useSessionCall, useSteam, useTeams, useTodoCounts } from '@/lib/queries';
import { teamAbbr, teamName } from '@/lib/format';
import { isMessageKey, useT } from '@/i18n';
import { Button, Card, StatRow, TeamSelect, Td, Th } from '@/ui';

type Act = (call: (session: GmApi['session']) => Promise<SessionResult>) => void;
type Lobby = Exclude<SessionStatus, { role: 'none' }>;
type Guest = Extract<SessionStatus, { role: 'guest' }>;
/** What a friend types to join over a direct connection: absent when the league is hosted on Steam. */
type Direct = Extract<SessionStatus, { role: 'host' }>['direct'];
type View = {
  teams: readonly Team[];
  /** A call is on its way: nothing else starts meanwhile. */
  busy: boolean;
  act: Act;
};

/** A hosted league: host yours, join a friend's, and the lobby once this game is in one. */
export function Online() {
  const { data: status } = useSession();
  const { data: teams = [], isError } = useTeams();
  const { data: steam } = useSteam();
  const call = useSessionCall();
  const todo = useTodoCounts(
    status && status.role !== 'none' ? status.peers.flatMap((p) => p.teamId ?? []) : [],
  );
  if (!status) return null;
  return (
    <OnlineView
      status={status}
      teams={isError ? [] : teams}
      todo={todo}
      defaultName={steam?.playerName || 'GM'}
      steam={!!steam?.enabled}
      busy={call.isPending}
      error={call.data && !call.data.ok ? call.data.error : null}
      act={call.mutate}
    />
  );
}

/** The screen from what it is handed, so a test can render each of its states. */
export function OnlineView({
  status,
  todo,
  defaultName,
  steam,
  error,
  ...view
}: View & {
  status: SessionStatus;
  /** What waits on each seated team's GM. */
  todo: Record<string, number | undefined>;
  defaultName: string;
  /** The game runs under Steam: a league can be hosted on it. */
  steam: boolean;
  /** Why the last call failed, as main said it. */
  error: string | null;
}) {
  const t = useT();
  // The host's and the engine's reasons we have words for; any other is shown as it came.
  const why = (reason: string) => {
    const key = `online.reason.${reason.replace('refused: ', '')}`;
    return isMessageKey(key) ? t(key) : t('online.failed', { reason });
  };
  return (
    <div className="max-w-5xl space-y-4">
      {status.role === 'none' && status.ended && (
        <p className="text-sm text-bad">{why(status.ended)}</p>
      )}
      {error && <p className="text-sm text-bad">{why(error)}</p>}
      {status.role === 'none' && <Start defaultName={defaultName} steam={steam} {...view} />}
      {status.role === 'host' && <Hosting direct={status.direct} {...view} />}
      {status.role === 'guest' && <Guesting status={status} {...view} />}
      {status.role !== 'none' && <Peers status={status} todo={todo} {...view} />}
    </div>
  );
}

const field = 'rounded-md border border-line bg-panel px-2 py-1';

/**
 * No session: host the league open in this game (on Steam when the game runs under it), or join
 * one by address, port and code. A league on Steam is joined from its host's invite, in Steam.
 */
function Start({
  teams,
  busy,
  act,
  defaultName,
  steam,
}: View & { defaultName: string; steam: boolean }) {
  const t = useT();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const as = name.trim() || defaultName;
  const to = Number(port);
  const reachable = address.trim() !== '' && Number.isInteger(to) && to >= 1 && to <= 65535;
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">{t('online.name')}</span>
        <input
          value={name}
          maxLength={32}
          placeholder={defaultName}
          onChange={(e) => setName(e.target.value)}
          className={`${field} max-w-xs`}
        />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t('online.host.title')}>
          <p className="mb-3 text-sm text-muted">{t('online.host.body')}</p>
          <div className="flex flex-wrap gap-2">
            {steam && (
              <Button
                variant="primary"
                disabled={busy || teams.length === 0}
                onClick={() => act((s) => s.host({ name: as, steam: true }))}
              >
                {t('online.host.steam')}
              </Button>
            )}
            <Button
              variant={steam ? 'ghost' : 'primary'}
              disabled={busy || teams.length === 0}
              onClick={() => act((s) => s.host({ name: as }))}
            >
              {t(steam ? 'online.host.direct' : 'online.host.go')}
            </Button>
          </div>
          {teams.length === 0 && <p className="mt-2 text-xs text-muted">{t('home.empty')}</p>}
        </Card>
        <Card title={t('online.join.title')}>
          {steam && <p className="mb-3 text-sm text-muted">{t('online.join.steam')}</p>}
          <p className="mb-3 text-sm text-muted">{t('online.join.body')}</p>
          <div className="mb-3 flex flex-wrap gap-3 text-sm">
            {(
              [
                ['address', address, setAddress, 'w-40'],
                ['port', port, setPort, 'w-20'],
                ['code', joinCode, setJoinCode, 'w-24 uppercase'],
              ] as const
            ).map(([key, value, set, width]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-muted">{t(`online.join.${key}`)}</span>
                <input
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  className={`${field} ${width}`}
                />
              </label>
            ))}
          </div>
          <Button
            variant="primary"
            disabled={busy || !reachable}
            onClick={() => act((s) => s.join({ address, port: to, joinCode, name: as }))}
          >
            {t('online.join.go')}
          </Button>
        </Card>
      </div>
      <p className="text-xs text-muted">{t('online.direct.note')}</p>
    </>
  );
}

/** Hosting: what a friend types to join, read out by the host; on Steam, the invite instead. */
function Hosting({ direct, busy, act }: View & { direct: Direct }) {
  const t = useT();
  return (
    <Card title={t('online.hosting')}>
      {direct ? (
        <>
          {/* The page's text cannot be selected; this is the text a host copies. */}
          <div className="grid select-text grid-cols-3 gap-4">
            <StatRow
              label={t('online.join.address')}
              value={direct.addresses.join(', ') || '127.0.0.1'}
            />
            <StatRow label={t('online.join.port')} value={direct.port} />
            <StatRow label={t('online.join.code')} value={direct.joinCode} />
          </div>
          <p className="my-3 text-xs text-muted">{t('online.direct.note')}</p>
        </>
      ) : (
        <p className="mb-3 text-sm text-muted">{t('online.steam.body')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {!direct && (
          <Button variant="primary" disabled={busy} onClick={() => act((s) => s.invite())}>
            {t('online.invite')}
          </Button>
        )}
        <Button
          disabled={busy}
          onClick={() => window.confirm(t('online.confirmStop')) && act((s) => s.leave())}
        >
          {t('online.stop')}
        </Button>
      </div>
    </Card>
  );
}

/** A guest: the line's state, the team he asks the host for, and the way out. */
function Guesting({ status, teams, busy, act }: View & { status: Guest }) {
  const t = useT();
  const me = status.peers[status.you];
  const taken = new Set(status.peers.map((p) => p.teamId));
  return (
    <Card title={t('online.guest')}>
      {status.reconnecting && <p className="mb-3 text-sm text-bad">{t('online.reconnecting')}</p>}
      <p className="mb-3 text-sm text-muted">{t('online.guest.body')}</p>
      <div className="flex flex-wrap items-center gap-3">
        {me?.teamId === null && (
          <TeamSelect
            teams={teams.filter((x) => !taken.has(x.id))}
            value={me.wish ?? ''}
            empty={t('online.ask')}
            onChange={(teamId) => teamId && act((s) => s.requestSeat({ teamId }))}
          />
        )}
        <Button disabled={busy} onClick={() => act((s) => s.leave())}>
          {t('online.leave')}
        </Button>
      </div>
    </Card>
  );
}

/** Who is in the league: team, state, what waits on him, and for the host his tools on each guest. */
function Peers({
  status,
  todo,
  teams,
  busy,
  act,
}: View & { status: Lobby; todo: Record<string, number | undefined> }) {
  const t = useT();
  const taken = new Set(status.peers.map((p) => p.teamId));
  // On Steam a kick has no code to change: the guest is kept out while this session lasts.
  const confirmKick =
    status.role === 'host' && !status.direct ? 'online.confirmKick.steam' : 'online.confirmKick';
  return (
    <Card title={t('online.lobby')}>
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <Th>{t('online.gm')}</Th>
            <Th>{t('standings.team')}</Th>
            <Th>{t('online.status')}</Th>
            <Th>{t('home.todoTitle')}</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {status.peers.map((p, i) => {
            const { key, wish } = p;
            const granted = p.can.includes('advance');
            return (
              <tr key={i} className="border-b border-line/50">
                <Td>
                  {p.name}
                  {i === status.you && <span className="text-muted"> {t('online.you')}</span>}
                </Td>
                <Td>
                  {p.teamId
                    ? teamName(teams, p.teamId)
                    : wish
                      ? t('online.asked', { team: teamName(teams, wish) })
                      : t('online.noTeam')}
                </Td>
                <Td className={!p.connected ? 'text-bad' : p.ready ? 'text-good' : 'text-muted'}>
                  {t(!p.connected ? 'online.away' : p.ready ? 'online.ready' : 'online.notReady')}
                  {granted && ` · ${t('online.clock')}`}
                </Td>
                <Td>{(p.teamId && todo[p.teamId]) ?? '–'}</Td>
                <Td>
                  {/* Only the host's list carries a guest's key, and only his tools take it. */}
                  {key !== undefined && (
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      {wish && p.teamId === null && !taken.has(wish) && (
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() => act((s) => s.seat({ key, teamId: wish }))}
                        >
                          {t('online.give', { team: teamAbbr(teams, wish, wish) })}
                        </Button>
                      )}
                      <TeamSelect
                        teams={teams.filter((x) => x.id === p.teamId || !taken.has(x.id))}
                        value={p.teamId ?? ''}
                        empty={t('online.noTeam')}
                        onChange={(teamId) => act((s) => s.seat({ key, teamId: teamId || null }))}
                      />
                      <Button
                        disabled={busy}
                        onClick={() => act((s) => s.grantAdvance({ key, on: !granted }))}
                      >
                        {t(granted ? 'online.ungrant' : 'online.grant')}
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          window.confirm(t(confirmKick, { name: p.name })) &&
                          act((s) => s.kick({ key }))
                        }
                      >
                        {t('online.kick')}
                      </Button>
                    </span>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
