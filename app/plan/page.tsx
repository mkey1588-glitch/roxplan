import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { addDays, dateOnlyToParts, todayIn, toDateOnly, weekdayOf } from '@/lib/date/dateOnly';
import type { DateOnly } from '@/lib/date/dateOnly';
import { generatePlan, toValidatablePlan } from '@/lib/engine';
import type { GeneratedPlan } from '@/lib/engine';
import { validatePlan } from '@/lib/engine/guardrails';
import type { PlannedSession, Prescription } from '@/lib/engine/prescribe';
import { zoneSpec } from '@/lib/engine/progression/running';
import type { IntensityZone } from '@/lib/engine/progression/running';
import type { PhaseType } from '@/lib/engine/types';
import { ATHLETIC_BACKGROUNDS, PHASE_TYPES } from '@/lib/engine/types';
import type { AthleticBackground } from '@/lib/engine/types';
import { DIVISIONS, STATION_IDS } from '@/lib/seeds/types';
import type { Division, StationId } from '@/lib/seeds/types';

/**
 * Weekly plan view (PRD §F4) and session detail (§F5).
 *
 * A server component: the engine is pure, so the plan is generated per request
 * from the inputs in the URL. No database, no client-side state — and because
 * generation is deterministic, the same link always renders the same plan.
 */

export const dynamic = 'force-dynamic';

/**
 * Run this route in Tokyo rather than Vercel's US-East default.
 *
 * The plan is generated per request, so before this every page view crossed
 * the Pacific twice: requests entered the network at the Osaka edge and then
 * executed in iad1, measured at 0.56-1.30s TTFB from Japan. The engine is a
 * pure function with no data dependencies, so there is nothing tying
 * execution to a region — it may as well run next to the reader.
 *
 * Revisit when the database lands: the function should sit beside Postgres,
 * and that becomes the constraint rather than this line.
 */
export const preferredRegion = ['hnd1'];

const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PHASE_STYLE: Record<PhaseType, { bar: string; label: string }> = {
  FOUNDATION: { bar: 'bg-(--color-phase-foundation)', label: 'phaseFoundation' },
  BUILD: { bar: 'bg-(--color-phase-build)', label: 'phaseBuild' },
  RACE_SPECIFIC: { bar: 'bg-(--color-phase-race)', label: 'phaseRaceSpecific' },
  TAPER: { bar: 'bg-(--color-phase-taper)', label: 'phaseTaper' },
};

function formatDay(date: DateOnly): { weekday: string; date: string } {
  const { day, month } = dateOnlyToParts(date);
  return {
    weekday: WEEKDAYS[weekdayOf(date)] ?? '',
    date: `${day} ${MONTHS[month] ?? ''}`,
  };
}

const km = (metres: number): string => `${(metres / 1000).toFixed(1)} km`;

function stationLabel(id: string): string {
  return id
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

function zoneLabel(zone: IntensityZone): string {
  const spec = zoneSpec(zone);
  return `${zone.replace('_', ' ').toLowerCase()} · RPE ${spec.rpeMin}-${spec.rpeMax}`;
}

function describe(prescription: Prescription): string | null {
  switch (prescription.kind) {
    case 'RUN':
      return prescription.distanceM === 0
        ? null
        : `${km(prescription.distanceM)} — ${zoneLabel(prescription.zone)}`;
    case 'INTERVALS':
      return `${prescription.reps} × ${km(prescription.repDistanceM)} — ${zoneLabel(prescription.zone)}, ${prescription.recoverySecs}s recovery`;
    case 'COMPROMISED_ROUNDS':
      return `${prescription.rounds} rounds — ${prescription.stationsPerRound} station${prescription.stationsPerRound > 1 ? 's' : ''}, then ${km(prescription.runDistanceM)}${prescription.raceOrderSequence ? ' (race order)' : ''}`;
    case 'SIMULATION':
      return `${prescription.stations} stations + ${km(prescription.runDistanceM)} running, at race weight`;
    case 'STRENGTH':
      return `${prescription.sets} × ${prescription.reps}`;
    case 'STATION_SKILL':
      return `${prescription.rounds} rounds — ${prescription.stations.map(stationLabel).join(', ')}`;
    case 'MOBILITY':
      return `${Math.round(prescription.durationSecs / 60)} min`;
    case 'REST':
      return null;
  }
}

function runningMetres(session: PlannedSession): number {
  let total = 0;
  for (const block of session.blocks) {
    const p = block.prescription;
    if (p.kind === 'RUN') total += p.distanceM;
    else if (p.kind === 'INTERVALS') total += p.reps * p.repDistanceM;
    else if (p.kind === 'COMPROMISED_ROUNDS') total += p.rounds * p.runDistanceM;
    else if (p.kind === 'SIMULATION') total += p.runDistanceM;
  }
  return total;
}

type Dict = (key: string, values?: Record<string, string | number>) => string;

function SessionCard({
  session,
  startDate,
  today,
  t,
  tPlan,
}: {
  session: PlannedSession;
  startDate: DateOnly;
  today: DateOnly;
  t: Dict;
  tPlan: Dict;
}): ReactNode {
  const date = addDays(startDate, session.dayOffset);
  const { weekday, date: dayLabel } = formatDay(date);
  const isToday = date === today;
  const isRest = session.type === 'REST';

  const details = session.blocks
    .map((block) => ({ block, text: describe(block.prescription) }))
    .filter((entry) => entry.text !== null);

  return (
    <article
      className={`rounded-xl border px-4 py-3.5 ${
        isToday ? 'border-(--color-accent) ring-1 ring-(--color-accent)' : 'border-(--color-line)'
      } ${isRest ? 'opacity-60' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-sm font-medium tabular-nums text-(--color-ink-soft)">
            {weekday} {dayLabel}
          </span>
          {isToday ? (
            <span className="rounded-full bg-(--color-accent) px-2 py-0.5 text-xs font-semibold text-white">
              {tPlan('today')}
            </span>
          ) : null}
        </div>
        {runningMetres(session) > 0 ? (
          <span className="text-xs tabular-nums text-(--color-ink-soft)">
            {km(runningMetres(session))}
          </span>
        ) : null}
      </div>

      <h3 className={`mt-1 ${isRest ? 'text-base' : 'text-lg font-semibold'}`}>
        {t(session.titleKey)}
      </h3>

      {details.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {details.map((entry) => (
            <li key={entry.block.order} className="text-sm text-(--color-ink-soft)">
              <span className="text-(--color-ink)">{t(entry.block.titleKey)}</span>
              {' — '}
              {entry.text}
              {entry.block.prescription.kind === 'STRENGTH'
                ? `: ${entry.block.prescription.movementPatternKeys.map((key) => t(key)).join(', ')}`
                : ''}
            </li>
          ))}
        </ul>
      ) : null}

      {session.gate !== null ? (
        <p className="mt-2.5 rounded-lg bg-(--color-line)/40 px-3 py-2 text-sm">
          🔒{' '}
          {session.gate.condition.type === 'CONTINUOUS_RUN_MINUTES'
            ? tPlan('lockedUntil', { value: session.gate.condition.value })
            : tPlan('lockedUntilRuns', { value: session.gate.condition.value })}
        </p>
      ) : null}

      {!isRest ? (
        <details className="mt-2.5">
          <summary className="cursor-pointer text-sm text-(--color-accent)">
            {tPlan('whyThis')}
          </summary>
          <p className="mt-1.5 text-sm text-(--color-ink-soft)">{t(session.rationaleKey)}</p>
        </details>
      ) : null}
    </article>
  );
}

function parseInputs(params: Record<string, string | string[] | undefined>): {
  background: AthleticBackground;
  division: Division;
  sessionsPerWeek: number;
  currentWeeklyRunM: number;
  longestRunMins: number;
  raceDate: DateOnly | null;
  weakestStations: StationId[];
  todayLocal: DateOnly;
} | null {
  const one = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const background = one('bg');
  const division = one('div') ?? 'OPEN_SINGLES';
  if (
    background === undefined ||
    !(ATHLETIC_BACKGROUNDS as readonly string[]).includes(background) ||
    !(DIVISIONS as readonly string[]).includes(division)
  ) {
    return null;
  }

  const timeZone = one('tz') ?? 'UTC';
  let todayLocal: DateOnly;
  try {
    todayLocal = todayIn(timeZone, new Date());
  } catch {
    todayLocal = todayIn('UTC', new Date());
  }

  const raceParam = one('race');
  let raceDate: DateOnly | null = null;
  if (raceParam !== undefined && raceParam !== '') {
    try {
      raceDate = toDateOnly(raceParam);
    } catch {
      return null;
    }
  }

  const weakestStations = (one('weak') ?? '')
    .split(',')
    .filter((id): id is StationId => (STATION_IDS as readonly string[]).includes(id));

  return {
    background: background as AthleticBackground,
    division: division as Division,
    sessionsPerWeek: Math.min(6, Math.max(2, Number(one('days') ?? 4))),
    currentWeeklyRunM: Math.max(0, Number(one('wkm') ?? 20) * 1000),
    longestRunMins: Math.max(0, Number(one('lrm') ?? 45)),
    raceDate,
    weakestStations,
    todayLocal,
  };
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const t = (await getTranslations()) as unknown as Dict;
  const tPlan = (await getTranslations('ui.plan')) as unknown as Dict;
  const tReadiness = (await getTranslations('ui.readiness')) as unknown as Dict;

  const inputs = parseInputs(params);
  if (inputs === null) {
    return (
      <main className="mx-auto max-w-xl px-5 py-16">
        <p>Missing or invalid plan details.</p>
        <Link href="/" className="mt-4 inline-block text-(--color-accent)">
          {tPlan('backToStart')}
        </Link>
      </main>
    );
  }

  const generated: GeneratedPlan = generatePlan({
    todayLocal: inputs.todayLocal,
    raceDate: inputs.raceDate,
    division: inputs.division,
    background: inputs.background,
    sessionsPerWeek: inputs.sessionsPerWeek,
    currentWeeklyRunM: inputs.currentWeeklyRunM,
    baselineConfidence: 'LOW',
    longestRunMins: inputs.longestRunMins,
    weakestStations: inputs.weakestStations,
  });

  const header = (
    <div className="mb-6 flex items-center justify-between gap-4">
      <Link href="/" className="text-sm text-(--color-accent)">
        ← {tPlan('backToStart')}
      </Link>
      {generated.calendar.raceDate !== null ? (
        <span className="text-sm text-(--color-ink-soft)">
          {tPlan('raceDay')}: {generated.calendar.raceDate}
        </span>
      ) : null}
    </div>
  );

  // §7.6 safety path. Deliberately not styled as a lesser experience.
  if (generated.kind === 'READINESS') {
    const readiness = generated.plan;
    return (
      <main className="mx-auto max-w-2xl px-5 py-10">
        {header}
        <h1 className="text-2xl font-semibold tracking-tight">{tReadiness('heading')}</h1>
        <div className="mt-5 space-y-3">
          {readiness.noteKeys.map((key) => (
            <p key={key} className="text-(--color-ink-soft)">
              {t(key)}
            </p>
          ))}
        </div>

        <h2 className="mt-9 text-lg font-semibold">{tReadiness('prohibitionsHeading')}</h2>
        <ul className="mt-3 space-y-2">
          {readiness.prohibitionKeys.map((key) => (
            <li key={key} className="text-sm text-(--color-ink-soft)">
              · {t(key)}
            </li>
          ))}
        </ul>

        <h2 className="mt-9 text-lg font-semibold">{tReadiness('sessionsHeading')}</h2>
        <div className="mt-3 space-y-2">
          {readiness.sessions.map((session) => {
            const { weekday, date } = formatDay(
              addDays(generated.calendar.startDate, session.dayOffset),
            );
            return (
              <div
                key={session.dayOffset}
                className="flex items-baseline gap-3 rounded-xl border border-(--color-line) px-4 py-3"
              >
                <span className="w-20 shrink-0 text-sm tabular-nums text-(--color-ink-soft)">
                  {weekday} {date}
                </span>
                <span>{t(session.titleKey)}</span>
              </div>
            );
          })}
        </div>
      </main>
    );
  }

  const { calendar, sessionsByWeek, volumes } = generated;
  const violations = validatePlan(toValidatablePlan(generated, inputs.background));
  const totalM = sessionsByWeek.flat().reduce((sum, s) => sum + runningMetres(s), 0);

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      {header}

      <h1 className="text-2xl font-semibold tracking-tight">
        {calendar.weeks} {tPlan('week').toLowerCase()}s
        {calendar.raceDate === null ? '' : ` → ${calendar.raceDate}`}
      </h1>

      <p className="mt-2 text-sm text-(--color-ink-soft)">
        {tPlan('totalRunning')}: {km(totalM)}
      </p>

      {calendar.leadInDays > 0 ? (
        <p className="mt-2 text-sm text-(--color-ink-soft)">
          {tPlan('leadIn', { days: calendar.leadInDays })}
        </p>
      ) : null}

      <p
        className={`mt-4 rounded-lg px-3 py-2 text-sm ${
          violations.length === 0
            ? 'bg-(--color-phase-taper)/15'
            : 'bg-(--color-phase-race)/20 font-semibold'
        }`}
      >
        {violations.length === 0
          ? tPlan('guardrailsPass')
          : tPlan('guardrailsFail', { count: violations.length })}
      </p>

      <p className="mt-3 text-xs text-(--color-ink-soft)">{tPlan('equipmentNote')}</p>

      <div className="mt-8 space-y-10">
        {sessionsByWeek.map((week, index) => {
          const volume = volumes[index];
          const phase = week[0]?.phase ?? 'FOUNDATION';
          const style = PHASE_STYLE[phase];
          const weekM = week.reduce((sum, s) => sum + runningMetres(s), 0);
          const count = week.filter((s) => s.type !== 'REST').length;

          return (
            <section key={index}>
              <div className="sticky top-0 z-10 -mx-5 bg-(--color-paper)/95 px-5 py-2 backdrop-blur">
                <div className="flex items-baseline gap-3">
                  <span className={`h-3 w-1.5 rounded-full ${style.bar}`} aria-hidden />
                  <h2 className="text-base font-semibold">
                    {tPlan('week')} {index + 1}
                    <span className="ml-2 font-normal text-(--color-ink-soft)">
                      {tPlan(style.label)}
                    </span>
                  </h2>
                </div>
                <p className="mt-0.5 pl-4.5 text-xs tabular-nums text-(--color-ink-soft)">
                  {km(weekM)} {tPlan('running')} · {count} {tPlan('sessions')}
                  {volume?.isDeload === true ? ` · ${tPlan('deload')}` : ''}
                </p>
              </div>

              <div className="mt-3 space-y-2.5">
                {week.map((session) => (
                  <SessionCard
                    key={session.dayOffset}
                    session={session}
                    startDate={calendar.startDate}
                    today={inputs.todayLocal}
                    t={t}
                    tPlan={tPlan}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

export const metadata = { title: 'Your plan · RoxPlan' };

// Referenced so the phase enum stays exhaustive if a phase is ever added.
void PHASE_TYPES;
