import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

/**
 * Placeholder landing page. It exists only to prove the i18n layer is wired
 * end to end — no string is hardcoded here. The real UI arrives at step 10,
 * after the engine and its guardrails are green.
 */
export default function HomePage(): ReactNode {
  const t = useTranslations('app');

  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">{t('name')}</h1>
      <p className="mt-3 text-base text-neutral-600">{t('tagline')}</p>
    </main>
  );
}
