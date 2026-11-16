import { useState } from 'react';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card } from '@/ui';

const STEPS = ['home', 'todo', 'sim', 'lines', 'trades', 'offseason'] as const;
const KEY = 'gm.walkthroughSeen';

export function walkthroughSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** First-run intro: shown once per install (renderer localStorage), skippable, reopened from the sidebar. */
export function Walkthrough({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [i, setI] = useState(0);
  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;
  const close = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // storage unavailable: it will simply show again next launch
    }
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card
        className="w-[28rem] max-w-full"
        title={t('walkthrough.step', { n: i + 1, total: STEPS.length })}
      >
        <h3 className="mb-2 text-lg font-semibold">
          {t(`walkthrough.${step}.title` as MessageKey)}
        </h3>
        <p className="mb-4 text-sm text-muted">{t(`walkthrough.${step}.body` as MessageKey)}</p>
        <div className="flex justify-between">
          <Button onClick={close}>{t('walkthrough.skip')}</Button>
          <div className="flex gap-2">
            {i > 0 && <Button onClick={() => setI(i - 1)}>{t('walkthrough.back')}</Button>}
            <Button variant="primary" onClick={last ? close : () => setI(i + 1)}>
              {t(last ? 'walkthrough.done' : 'walkthrough.next')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
