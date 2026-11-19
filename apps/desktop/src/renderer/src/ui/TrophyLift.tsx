import { useEffect, useRef, useState } from 'react';
import { useStatus, useTeams } from '@/lib/queries';
import { teamName } from '@/lib/format';
import { useT } from '@/i18n';

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

  useEffect(() => {
    if (!shown) return;
    const done = () => setShown(null);
    const timer = setTimeout(done, 6000);
    window.addEventListener('keydown', done);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', done);
    };
  }, [shown]);

  if (!shown) return null;
  const text = t('cutscene.trophy', { team: teamName(teams, shown) });
  return (
    <div
      role="dialog"
      aria-label={text}
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-black/85 text-center"
      onClick={() => setShown(null)}
    >
      <div className="trophy-lift text-8xl" aria-hidden>
        🏆
      </div>
      <p className="trophy-text mt-6 text-3xl font-bold text-accent">{text}</p>
      <p className="mt-3 text-xs text-muted">{t('cutscene.skip')}</p>
    </div>
  );
}
