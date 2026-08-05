import { addDays, dateOnlyToParts, weekdayOf } from '@/lib/date/dateOnly';
import type { DateOnly } from '@/lib/date/dateOnly';
import enMessages from '@/messages/en.json';

import { validatePlan } from '@/lib/engine/guardrails';
import { generatePlan, toValidatablePlan } from '@/lib/engine';
import type { GeneratePlanInput, GeneratedPlan, TrainingPlan } from '@/lib/engine';
import { phaseSpans } from '@/lib/engine/phases';
import type { PlannedSession, Prescription } from '@/lib/engine/prescribe';
import { zoneSpec } from '@/lib/engine/progression/running';
import type { ReadinessPlan } from '@/lib/engine/runway';

/**
 * Renders a generated plan as something a coach can read.
 *
 * This is a display layer and lives outside `lib/engine` deliberately: it
 * resolves i18n keys into English, formats SI values for humans, and knows
 * about weekdays. The engine does none of that.
 *
 * Its output is checked in as file snapshots. A plan can pass every automated
 * guardrail and still be one no sensible coach would prescribe — that failure
 * mode is invisible to assertions and obvious to a person reading a week.
 */

const WEEKDAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function t(key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      enMessages,
    );
  return typeof value === 'string' ? value : `⟨missing: ${key}⟩`;
}

function formatDate(date: DateOnly): string {
  const { day, month } = dateOnlyToParts(date);
  const weekday = WEEKDAY_NAMES[weekdayOf(date)] ?? '???';
  return `${weekday} ${String(day).padStart(2, '0')} ${MONTH_NAMES[month] ?? '???'}`;
}

function km(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}

function prettyStation(id: string): string {
  return id
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

function zoneLabel(zone: Parameters<typeof zoneSpec>[0]): string {
  const spec = zoneSpec(zone);
  const name = zone.replace('_', ' ').toLowerCase();
  return `${name} (RPE ${spec.rpeMin}-${spec.rpeMax})`;
}

function describe(prescription: Prescription): string {
  switch (prescription.kind) {
    case 'RUN':
      return prescription.distanceM === 0
        ? ''
        : `${km(prescription.distanceM)} @ ${zoneLabel(prescription.zone)}`;
    case 'INTERVALS':
      return `${prescription.reps} × ${km(prescription.repDistanceM)} @ ${zoneLabel(prescription.zone)}, ${prescription.recoverySecs}s recovery`;
    case 'COMPROMISED_ROUNDS':
      return `${prescription.rounds} rounds: ${prescription.stationsPerRound} station${prescription.stationsPerRound > 1 ? 's' : ''} → ${km(prescription.runDistanceM)} @ ${zoneLabel(prescription.zone)}${prescription.raceOrderSequence ? ', race order' : ''}`;
    case 'SIMULATION':
      return `${prescription.stations} stations + ${km(prescription.runDistanceM)} running, race weight`;
    case 'STRENGTH':
      return `${prescription.sets} × ${prescription.reps} — ${prescription.movementPatternKeys.map(t).join(', ')}`;
    case 'STATION_SKILL':
      return `${prescription.rounds} rounds — ${prescription.stations.map(prettyStation).join(', ')}`;
    case 'MOBILITY':
      return `${Math.round(prescription.durationSecs / 60)} min`;
    case 'REST':
      return '';
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

function formatSession(session: PlannedSession, startDate: DateOnly): string[] {
  const date = formatDate(addDays(startDate, session.dayOffset));
  const title = t(session.titleKey);
  const lines: string[] = [];

  const detail = session.blocks
    .map((block) => describe(block.prescription))
    .filter((text) => text !== '')
    .join('  ·  ');

  lines.push(`   ${date}   ${title.padEnd(24)}${detail}`);

  if (session.gate !== null) {
    const condition = session.gate.condition;
    const requirement =
      condition.type === 'CONTINUOUS_RUN_MINUTES'
        ? `${condition.value} min continuous run`
        : condition.type === 'COMPROMISED_RUNS_COMPLETED'
          ? `${condition.value} compromised run${condition.value > 1 ? 's' : ''} completed`
          : `${condition.value} weeks elapsed`;
    lines.push(
      `${' '.repeat(16)}   [locked until ${requirement} — serves ${t(`plan.session.${session.gate.fallbackType === 'EASY_RUN' ? 'easyRun' : 'compromisedRun'}`).toLowerCase()} meanwhile]`,
    );
  }

  return lines;
}

function formatTrainingPlan(label: string, plan: TrainingPlan, input: GeneratePlanInput): string {
  const lines: string[] = [];
  const { calendar, allocation, sessionsByWeek } = plan;

  const violations = validatePlan(toValidatablePlan(plan, input.background));

  lines.push('='.repeat(96));
  lines.push(label);
  lines.push('='.repeat(96));
  lines.push(
    `${input.background} · ${input.sessionsPerWeek} sessions/week · ${input.division} · baseline ${input.baselineConfidence}`,
  );
  lines.push(
    calendar.raceDate === null
      ? `Rolling block · ${calendar.weeks} weeks · starts ${calendar.startDate}`
      : `${calendar.weeks} weeks · starts ${calendar.startDate} · races ${calendar.raceDate} · ${calendar.leadInDays} lead-in day(s)`,
  );
  lines.push(
    `Phases: ${phaseSpans(allocation)
      .map((span) => `${span.type} ${span.startWeek}-${span.endWeek}`)
      .join(' · ')}`,
  );
  lines.push(`Current weekly running: ${km(input.currentWeeklyRunM)} · longest run ${input.longestRunMins} min`);
  lines.push(
    violations.length === 0
      ? 'Guardrails: PASS'
      : `Guardrails: ${violations.length} VIOLATION(S) — ${violations.map((v) => v.rule).join(', ')}`,
  );
  lines.push('');
  lines.push(
    'NOTE: equipment is not yet an engine input. Station substitution (§F5) is a',
  );
  lines.push('render-time concern and arrives with the UI, so these plans assume full access.');
  lines.push('');

  sessionsByWeek.forEach((week, index) => {
    const weekIndex = index + 1;
    const phase = week[0]?.phase ?? 'UNKNOWN';
    const metres = week.reduce((total, session) => total + runningMetres(session), 0);
    const sessionCount = week.filter((session) => session.type !== 'REST').length;
    const volume = plan.volumes[index];
    const deload = volume?.isDeload === true ? '  ⟨deload⟩' : '';

    lines.push(
      `WEEK ${String(weekIndex).padStart(2)}  ${phase.padEnd(14)} running ${km(metres).padStart(8)}   ${sessionCount} sessions${deload}`,
    );
    lines.push('-'.repeat(96));
    for (const session of week) lines.push(...formatSession(session, calendar.startDate));
    lines.push('');
  });

  const totalM = sessionsByWeek
    .flat()
    .reduce((total, session) => total + runningMetres(session), 0);
  lines.push(`TOTAL RUNNING ACROSS PLAN: ${km(totalM)}`);
  lines.push('');

  return lines.join('\n');
}

function formatReadinessPlan(
  label: string,
  readiness: ReadinessPlan,
  startDate: DateOnly,
  raceDate: DateOnly | null,
): string {
  const lines: string[] = [];

  lines.push('='.repeat(96));
  lines.push(label);
  lines.push('='.repeat(96));
  lines.push(`READINESS PLAN — not a training plan (PRD §7.6)`);
  lines.push(`${readiness.weeks} week(s) · starts ${startDate} · races ${raceDate ?? 'n/a'}`);
  lines.push('');

  lines.push('WHAT WE ARE TELLING THE ATHLETE');
  lines.push('-'.repeat(96));
  for (const key of readiness.noteKeys) {
    lines.push(`  · ${t(key)}`);
    lines.push('');
  }

  lines.push('WHAT THIS PLAN DELIBERATELY WILL NOT DO');
  lines.push('-'.repeat(96));
  for (const key of readiness.prohibitionKeys) lines.push(`  · ${t(key)}`);
  lines.push('');

  lines.push('SESSIONS');
  lines.push('-'.repeat(96));
  for (const session of readiness.sessions) {
    lines.push(
      `   ${formatDate(addDays(startDate, session.dayOffset))}   ${t(session.titleKey)}`,
    );
  }
  lines.push('');

  return lines.join('\n');
}

/** Renders any generated plan as readable text. */
export function formatPlan(label: string, input: GeneratePlanInput): string {
  const generated: GeneratedPlan = generatePlan(input);

  return generated.kind === 'TRAINING'
    ? formatTrainingPlan(label, generated, input)
    : formatReadinessPlan(
        label,
        generated.plan,
        generated.calendar.startDate,
        generated.calendar.raceDate,
      );
}
