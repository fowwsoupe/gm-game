import { useUi } from '@/stores/ui';
import { en, type MessageKey } from './en';
import { fr } from './fr';

export type Locale = 'en' | 'fr';
const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, fr };

/** Translate a key, filling {placeholders}. Missing translations fall back to English. */
function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const template = dictionaries[locale][key] ?? en[key];
  return vars
    ? template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`))
    : template;
}

/** Whether a string from the sim (a news headline) is a key we can translate. */
export const isMessageKey = (key: string): key is MessageKey => key in en;

/** Hook used by components: `const t = useT(); t('nav.home')`. */
export function useT() {
  const locale = useUi((s) => s.locale);
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

export type { MessageKey };
