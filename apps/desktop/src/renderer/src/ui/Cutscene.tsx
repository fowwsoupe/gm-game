import { useEffect } from 'react';
import { useT } from '@/i18n';

/** Full-screen cutscene shell: an icon and a line, skippable by click or any key, ends by itself. */
export function Cutscene({
  icon,
  text,
  onDone,
}: {
  icon: string;
  text: string;
  onDone: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const timer = setTimeout(onDone, 6000);
    window.addEventListener('keydown', onDone);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onDone);
    };
  }, [onDone]);
  return (
    <div
      role="dialog"
      aria-label={text}
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-black/85 text-center"
      onClick={onDone}
    >
      <div className="trophy-lift text-8xl" aria-hidden>
        {icon}
      </div>
      <p className="trophy-text mt-6 text-3xl font-bold text-accent">{text}</p>
      <p className="mt-3 text-xs text-muted">{t('cutscene.skip')}</p>
    </div>
  );
}
