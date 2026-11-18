import { usePlayers, useTeams } from '@/lib/queries';
import { useT } from '@/i18n';
import { useUi } from '@/stores/ui';
import { Button, Face } from '@/ui';
import { fullName, teamName } from '@/lib/format';
import type { TeamId } from '@gm/shared';
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
    </div>
  );
}
