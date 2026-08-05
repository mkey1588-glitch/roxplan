import type { PlanCalendar } from './calendar';
import { totalDays } from './calendar';
import type { SessionType } from './templates';
import type { AthleticBackground } from './types';

/**
 * The insufficient-runway path (PRD §7.6).
 *
 * At or below 4 weeks there is not enough time to build race fitness safely,
 * so the engine does not generate a performance plan at all. It generates a
 * **readiness plan**: technique familiarisation on all eight stations, one
 * moderate compromised-running session, pacing guidance, a taper, and race-day
 * logistics.
 *
 * "This is a safety path, not a degraded-experience path. It should read like
 * honest coaching." Guardrail 7 makes routing here mandatory — a standard plan
 * at this range is a P0 bug.
 */

/** At or below this many whole weeks, route here rather than to a real plan. */
export const MAX_READINESS_WEEKS = 4;

export interface ReadinessSession {
  readonly dayOffset: number;
  readonly type: SessionType;
  /** i18n key for the session title (D5 — the engine emits keys, not prose). */
  readonly titleKey: string;
  readonly params?: Readonly<Record<string, number | string>>;
}

export interface ReadinessPlan {
  readonly kind: 'READINESS';
  readonly weeks: number;
  readonly sessions: readonly ReadinessSession[];
  /** Headline messages, shown before any session. */
  readonly noteKeys: readonly string[];
  /** What this plan explicitly will not do, and why (§7.6 point 3). */
  readonly prohibitionKeys: readonly string[];
}

/**
 * Days before race day that are always full rest.
 *
 * Nothing trainable is gained in the last 48 hours, and an athlete this close
 * to an under-prepared race is the one most likely to try to cram.
 */
const FULL_REST_DAYS_BEFORE_RACE = 2;

/** Minimum clear days between the single compromised run and race day. */
const COMPROMISED_RUN_MIN_DAYS_BEFORE_RACE = 7;

/**
 * Generates the readiness plan.
 *
 * @param calendar a race-anchored calendar whose `weeks` is at or below
 *   {@link MAX_READINESS_WEEKS}
 * @param background used only to add the extra honesty a BEGINNER is owed
 */
export function generateReadinessPlan(
  calendar: PlanCalendar,
  background: AthleticBackground,
): ReadinessPlan {
  if (calendar.raceDate === null) {
    throw new Error('The readiness plan is race-anchored; a rolling plan has no race to prepare for.');
  }
  if (calendar.weeks > MAX_READINESS_WEEKS) {
    throw new RangeError(
      `${calendar.weeks} weeks is enough runway for a real plan; the readiness path is for ${MAX_READINESS_WEEKS} weeks or fewer.`,
    );
  }

  const days = totalDays(calendar);
  const lastDayOffset = days - 1;
  const sessions: ReadinessSession[] = [];

  // Station technique, every third day, at light load. The goal is that
  // nothing on race day is the first time — not fitness, which cannot be
  // built in this window anyway.
  //
  // The `- 1` matters: the rest days occupy the two offsets *before* race day,
  // so the last day training may occupy is the one before those. Without it a
  // technique session lands on top of a rest day at 3-week runways.
  const lastTrainingDay = lastDayOffset - FULL_REST_DAYS_BEFORE_RACE - 1;
  for (let dayOffset = 0; dayOffset <= lastTrainingDay; dayOffset += 3) {
    sessions.push({
      dayOffset,
      type: 'STATION_SKILL',
      titleKey: 'plan.readiness.stationTechnique',
    });
  }

  // Exactly one moderate compromised run, far enough out to recover from.
  // Its purpose is to teach the athlete what a post-station run feels like
  // before race day does it for them.
  const compromisedDay = lastDayOffset - COMPROMISED_RUN_MIN_DAYS_BEFORE_RACE;
  if (compromisedDay > 0) {
    const existing = sessions.findIndex((session) => session.dayOffset === compromisedDay);
    const compromised: ReadinessSession = {
      dayOffset: compromisedDay,
      type: 'COMPROMISED_RUN',
      titleKey: 'plan.readiness.singleCompromisedRun',
    };
    if (existing >= 0) sessions[existing] = compromised;
    else sessions.push(compromised);
  }

  // Full rest into race day.
  for (let back = FULL_REST_DAYS_BEFORE_RACE; back >= 1; back -= 1) {
    sessions.push({
      dayOffset: lastDayOffset - back,
      type: 'REST',
      titleKey: 'plan.readiness.restBeforeRace',
    });
  }

  sessions.sort((a, b) => a.dayOffset - b.dayOffset);

  const noteKeys = [
    // §7.6 point 1: tell the user plainly.
    'plan.readiness.notEnoughTime',
    'plan.readiness.whatThisPlanIs',
    'plan.readiness.pacingGuidance',
    'plan.readiness.raceDayLogistics',
  ];

  // §7.6 point 4: a beginner this close to a race is owed more than a plan.
  if (background === 'BEGINNER') {
    noteKeys.push('plan.readiness.considerLaterRace', 'plan.readiness.considerRelayOrDoubles');
  }

  return Object.freeze({
    kind: 'READINESS' as const,
    weeks: calendar.weeks,
    sessions: Object.freeze(sessions),
    noteKeys: Object.freeze(noteKeys),
    // §7.6 point 3: state the prohibitions rather than silently omitting them.
    // An athlete who knows *why* there is no simulation is less likely to
    // invent one for themselves.
    prohibitionKeys: Object.freeze([
      'plan.readiness.noSimulations',
      'plan.readiness.noNewMaximalLoading',
      'plan.readiness.noVolumeIncrease',
    ]),
  });
}
