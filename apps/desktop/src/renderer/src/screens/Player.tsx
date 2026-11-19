import { useState } from 'react';
import { useDispatch, usePlayers, useTeams } from '@/lib/queries';
import { useT } from '@/i18n';
import { useUi } from '@/stores/ui';
import { Button, Card, Face } from '@/ui';
import { fullName, teamName } from '@/lib/format';
import type { PlayerId, TeamId } from '@gm/shared';
import { Profile } from './Roster';

/** One player's own page: his card, contract, form and career, from wherever you opened him. */
export function Player() {
  const t = useT();
  const focus = useUi((s) => s.focus);
  const setScreen = useUi((s) => s.setScreen);
  const openRoster = useUi((s) => s.openRoster);
  const { data: teams = [] } = useTeams();
  const teamId = focus?.teamId === 'fa' ? null : (focus?.teamId as TeamId | undefined);
  const { data: players = [] } = usePlayers(focus ? teamId : undefined);
  const p = players.find((x) => x.id === focus?.playerId);
  if (!focus || !p) {
    return (
      <div className="space-y-3">
        <p className="text-muted">{t('player.missing')}</p>
        <Button onClick={() => setScreen('roster')}>{t('player.back')}</Button>
      </div>
    );
  }
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-4">
        <Face seed={p.id} age={p.age} size={112} />
        <div>
          <h1 className="text-xl font-semibold">{fullName(p)}</h1>
          <p className="text-sm text-muted">
            {p.teamId ? teamName(teams, p.teamId) : t('roster.freeAgents')} · {p.position}
          </p>
        </div>
        <div className="ml-auto">
          <Button onClick={() => openRoster(focus.teamId, p.id)}>{t('player.back')}</Button>
        </div>
      </div>
      <Profile player={p} signFor={teams.find((x) => x.userControlled)?.id} standalone />
      {p.teamId && <CommissionerCard key={p.id} playerId={p.id} teamId={p.teamId} />}
    </div>
  );
}

/** Commissioner mode: move a rostered player to any team or out to free agency. The sim validates; an error shows beside the button. */
function CommissionerCard({ playerId, teamId }: { playerId: PlayerId; teamId: TeamId }) {
  const t = useT();
  const dispatch = useDispatch();
  const { data: teams = [] } = useTeams();
  const [to, setTo] = useState<string>('fa');
  const error = dispatch.data && !dispatch.data.ok ? dispatch.data.error.message : null;
  return (
    <Card title={t('commissioner.title')}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-md border border-line bg-panel px-2 py-1"
        >
          <option value="fa">{t('roster.freeAgents')}</option>
          {teams
            .filter((x) => x.id !== teamId)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {teamName(teams, x.id)}
              </option>
            ))}
        </select>
        <Button
          variant="primary"
          disabled={dispatch.isPending}
          onClick={() =>
            dispatch.mutate({
              kind: 'commissioner.move',
              playerId,
              teamId: to === 'fa' ? null : (to as TeamId),
            })
          }
        >
          {t('commissioner.move')}
        </Button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
      <p className="mt-2 text-xs text-muted">{t('commissioner.note')}</p>
    </Card>
  );
}
