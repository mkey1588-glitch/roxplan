'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';

import { ATHLETIC_BACKGROUNDS } from '@/lib/engine/types';
import { STATION_IDS } from '@/lib/seeds/types';

/**
 * Onboarding (PRD §F1).
 *
 * There is no database yet, so the athlete's answers travel in the URL and the
 * plan is regenerated from them on every view. That is not a workaround: §8
 * already requires `Plan` to be fully regenerable from its inputs, so the URL
 * is simply the first place those inputs live.
 */

const BACKGROUND_LABEL_KEYS: Record<string, string> = {
  RUNNER: 'backgroundRunner',
  STRENGTH: 'backgroundStrength',
  HYBRID: 'backgroundHybrid',
  BEGINNER: 'backgroundBeginner',
};

function stationLabel(id: string): string {
  return id
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      {help === undefined ? null : (
        <span className="mt-0.5 block text-sm text-(--color-ink-soft)">{help}</span>
      )}
      <div className="mt-2">{children}</div>
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-(--color-line) bg-transparent px-3 py-2 outline-none focus:border-(--color-accent)';

export default function OnboardingPage(): ReactNode {
  const t = useTranslations('ui.onboarding');
  const router = useRouter();

  const [noRace, setNoRace] = useState(false);
  const [raceDate, setRaceDate] = useState('');
  const [background, setBackground] = useState('HYBRID');
  const [sessionsPerWeek, setSessionsPerWeek] = useState(4);
  const [weeklyRunKm, setWeeklyRunKm] = useState(20);
  const [longestRunMins, setLongestRunMins] = useState(45);
  const [division, setDivision] = useState('OPEN_SINGLES');
  const [weakest, setWeakest] = useState<string[]>([]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    const params = new URLSearchParams({
      bg: background,
      div: division,
      days: String(sessionsPerWeek),
      wkm: String(weeklyRunKm),
      lrm: String(longestRunMins),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (!noRace && raceDate !== '') params.set('race', raceDate);
    if (weakest.length > 0) params.set('weak', weakest.join(','));
    router.push(`/plan?${params.toString()}`);
  }

  return (
    <main className="mx-auto max-w-xl px-5 py-10 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
      <p className="mt-2 text-(--color-ink-soft)">{t('subtitle')}</p>

      <form onSubmit={submit} className="mt-8 space-y-7">
        <Field label={t('raceDate')} help={t('raceDateHelp')}>
          <input
            type="date"
            value={raceDate}
            disabled={noRace}
            onChange={(event) => setRaceDate(event.target.value)}
            className={`${inputClass} disabled:opacity-40`}
          />
          <label className="mt-3 flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={noRace}
              onChange={(event) => setNoRace(event.target.checked)}
              className="size-5"
            />
            {t('noRaceDate')}
          </label>
        </Field>

        <Field label={t('background')} help={t('backgroundHelp')}>
          <div className="space-y-2">
            {ATHLETIC_BACKGROUNDS.map((value) => (
              <label
                key={value}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 ${
                  background === value
                    ? 'border-(--color-accent) bg-(--color-accent)/8'
                    : 'border-(--color-line)'
                }`}
              >
                <input
                  type="radio"
                  name="background"
                  value={value}
                  checked={background === value}
                  onChange={() => setBackground(value)}
                  className="size-5"
                />
                <span className="text-sm">{t(BACKGROUND_LABEL_KEYS[value] ?? value)}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label={t('sessionsPerWeek')}>
          <div className="flex gap-2">
            {[2, 3, 4, 5, 6].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSessionsPerWeek(value)}
                className={`flex-1 rounded-lg border py-3 text-base ${
                  sessionsPerWeek === value
                    ? 'border-(--color-accent) bg-(--color-accent)/10 font-semibold'
                    : 'border-(--color-line)'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t('weeklyRun')} help={t('weeklyRunHelp')}>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={0}
              max={200}
              value={weeklyRunKm}
              onChange={(event) => setWeeklyRunKm(Number(event.target.value))}
              className={inputClass}
            />
            <span className="text-sm text-(--color-ink-soft)">{t('km')}</span>
          </div>
        </Field>

        <Field label={t('longestRun')} help={t('longestRunHelp')}>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={0}
              max={300}
              value={longestRunMins}
              onChange={(event) => setLongestRunMins(Number(event.target.value))}
              className={inputClass}
            />
            <span className="text-sm text-(--color-ink-soft)">{t('minutes')}</span>
          </div>
        </Field>

        <Field label={t('division')}>
          <select
            value={division}
            onChange={(event) => setDivision(event.target.value)}
            className={inputClass}
          >
            <option value="OPEN_SINGLES">Open Singles</option>
            <option value="PRO_SINGLES">Pro Singles</option>
          </select>
        </Field>

        <Field label={t('weakest')} help={t('weakestHelp')}>
          <div className="flex flex-wrap gap-2">
            {STATION_IDS.map((id) => {
              const on = weakest.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    setWeakest(on ? weakest.filter((s) => s !== id) : [...weakest, id])
                  }
                  className={`rounded-full border px-3.5 py-2 text-sm ${
                    on
                      ? 'border-(--color-accent) bg-(--color-accent)/10'
                      : 'border-(--color-line)'
                  }`}
                >
                  {stationLabel(id)}
                </button>
              );
            })}
          </div>
        </Field>

        <button
          type="submit"
          className="w-full rounded-lg bg-(--color-accent) py-3.5 text-base font-semibold text-white"
        >
          {t('submit')}
        </button>
      </form>
    </main>
  );
}
