import { useEffect, useRef, useState } from 'react';
import { useStatus, useTeams } from '@/lib/queries';
import { teamName } from '@/lib/format';
import { useT } from '@/i18n';
import { Cutscene } from './Cutscene';

/**
 * Cutscene: the Cup lift when one of your teams wins it. Plays only when the champion
 * appears during this session (not when a finished season is loaded), is skippable by
 * click or any key, and ends by itself.
 */
export function TrophyLift() {
  const t = useT();
  const { data: status } = useStatus();
  const { data: teams = [] } = useTeams();
  const prev = useRef<string | null | undefined>(undefined);
  const [shown, setShown] = useState<string | null>(null);
  const champ = status?.championTeamId ?? null;

  useEffect(() => {
    if (!status) return;
    // undefined: first status of the session, never play for an already-decided season.
    if (prev.current === null && champ && teams.find((x) => x.id === champ)?.userControlled) {
      setShown(champ);
    }
    prev.current = champ;
  }, [status, champ, teams]);

  if (!shown) return null;
  return (
    <Cutscene
      icon="🏆"
      text={t('cutscene.trophy', { team: teamName(teams, shown) })}
      onDone={() => setShown(null)}
    />
  );
}
