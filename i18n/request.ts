import { getRequestConfig } from 'next-intl/server';

/**
 * next-intl request configuration (DECISIONS.md D5).
 *
 * English-only for now, but every user-facing string routes through the i18n
 * layer from the first commit — including the engine's output, which emits
 * message keys and parameters rather than prose. Adding a locale later is a
 * matter of another file under `messages/`, not a UI refactor.
 */
export const DEFAULT_LOCALE = 'en';

export const SUPPORTED_LOCALES = [DEFAULT_LOCALE] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export default getRequestConfig(async () => {
  const locale: Locale = DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
