import type { DateOnly } from '@/lib/date/dateOnly';
import { addDays, differenceInDays, isBefore } from '@/lib/date/dateOnly';

/**
 * Plan calendar derivation (ERRATA R1).
 *
 * Plans are anchored **backwards from race day**, not forwards from today.
 * Race day is the final day of the final taper week, which is what makes
 * §7.2's "2 full rest days before race day" placeable at all. `startDate` is
 * therefore derived, never supplied.
 *
 * A race date almost never divides evenly by 7, so the 0-6 days between
 * today and `startDate` become an unstructured **lead-in**: no prescriptions,
 * no guardrail obligations, not a week 0. They sit outside the plan.
 *
 *   availableDays = today..raceDate inclusive
 *   weeks         = floor(availableDays / 7)
 *   leadInDays    = availableDays - 7 * weeks        (0-6)
 *   startDate     = raceDate - 7 * weeks + 1
 *   race day      = startDate + 7 * weeks - 1
 *   week N        = dayOffset [7(N-1) .. 7N-1]
 *
 * Note on `availableDays`: R1 writes the first line as
 * `floor(daysUntilRace / 7)`, but `daysUntilRace` is an exclusive difference,
 * which yields a leftover of 1-7 days rather than the 0-6 that R1 states in
 * the same breath. Worked example: a race exactly 13 days out has 14 usable
 * days and should give a 2-week plan with no lead-in; the exclusive form
 * gives a 1-week plan with a 7-day lead-in, silently discarding a training
 * week. We count inclusively, which is the reading that makes R1's own
 * "leftover 0-6 days" true. See ERRATA F30.
 */

/** Thrown when a race date has already passed (ERRATA F27). */
export class RaceDateInPastError extends Error {
  constructor(
    readonly raceDate: DateOnly,
    readonly todayLocal: DateOnly,
  ) {
    super(`Race date ${raceDate} is before today (${todayLocal}).`);
    this.name = 'RaceDateInPastError';
  }
}

/** Thrown when a day offset falls outside the plan's span. */
export class DayOffsetOutOfRangeError extends RangeError {
  constructor(
    readonly dayOffset: number,
    readonly totalDays: number,
  ) {
    super(`Day offset ${dayOffset} is outside a plan of ${totalDays} days (0..${totalDays - 1}).`);
    this.name = 'DayOffsetOutOfRangeError';
  }
}

export interface PlanCalendar {
  /** Day 0 of the plan. Derived from the race date, not from today. */
  readonly startDate: DateOnly;
  /** Null for rolling plans with no race booked (DECISIONS.md D4). */
  readonly raceDate: DateOnly | null;
  /** Whole training weeks, including the taper week. */
  readonly weeks: number;
  /**
   * Unstructured days between today and `startDate`, 0-6. Outside the plan:
   * no sessions, no guardrail obligations.
   */
  readonly leadInDays: number;
  /** The date this calendar was derived against. */
  readonly todayLocal: DateOnly;
}

const DAYS_PER_WEEK = 7;

/**
 * Derives the calendar for a race-anchored plan.
 *
 * @param todayLocal today's date in the athlete's timezone (D7) — passed in,
 *   never read from the clock, so generation stays deterministic
 * @throws RaceDateInPastError if the race has already happened
 */
export function deriveRaceCalendar(todayLocal: DateOnly, raceDate: DateOnly): PlanCalendar {
  if (isBefore(raceDate, todayLocal)) throw new RaceDateInPastError(raceDate, todayLocal);

  // Inclusive of both today and race day: a race "today" leaves one usable day.
  const availableDays = differenceInDays(todayLocal, raceDate) + 1;
  const weeks = Math.floor(availableDays / DAYS_PER_WEEK);
  const leadInDays = availableDays - weeks * DAYS_PER_WEEK;

  return {
    startDate: addDays(todayLocal, leadInDays),
    raceDate,
    weeks,
    leadInDays,
    todayLocal,
  };
}

/**
 * Derives the calendar for a rolling plan with no race date (D4).
 *
 * Nothing to anchor backwards from, so training starts today and there is no
 * lead-in. Plans never expire — a user "considering" HYROX keeps a coherent
 * plan indefinitely (Principle 6).
 */
export function deriveRollingCalendar(todayLocal: DateOnly, weeks: number): PlanCalendar {
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new RangeError(`A rolling plan needs at least 1 whole week, received ${weeks}.`);
  }

  return {
    startDate: todayLocal,
    raceDate: null,
    weeks,
    leadInDays: 0,
    todayLocal,
  };
}

/** Total days the plan spans. */
export function totalDays(calendar: PlanCalendar): number {
  return calendar.weeks * DAYS_PER_WEEK;
}

/**
 * The day offset of race day: always the final day of the plan.
 *
 * Null for rolling plans. Note this is a plan-relative offset, so it stays
 * correct if the plan is later re-anchored.
 */
export function raceDayOffset(calendar: PlanCalendar): number | null {
  if (calendar.raceDate === null) return null;
  return totalDays(calendar) - 1;
}

/** The calendar date for a plan day offset. */
export function dateForDayOffset(calendar: PlanCalendar, dayOffset: number): DateOnly {
  const days = totalDays(calendar);
  if (!Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset >= days) {
    throw new DayOffsetOutOfRangeError(dayOffset, days);
  }
  return addDays(calendar.startDate, dayOffset);
}

/**
 * The plan day offset for a calendar date.
 *
 * Negative during the lead-in, and >= totalDays after race day. Callers that
 * need "is this date in the plan?" should use {@link isWithinPlan}.
 */
export function dayOffsetForDate(calendar: PlanCalendar, date: DateOnly): number {
  return differenceInDays(calendar.startDate, date);
}

export function isWithinPlan(calendar: PlanCalendar, date: DateOnly): boolean {
  const offset = dayOffsetForDate(calendar, date);
  return offset >= 0 && offset < totalDays(calendar);
}

/** True for the 0-6 unstructured days before the plan begins. */
export function isLeadInDate(calendar: PlanCalendar, date: DateOnly): boolean {
  const offset = dayOffsetForDate(calendar, date);
  return offset < 0 && offset >= -calendar.leadInDays;
}

/** The 1-based week index containing a day offset. */
export function weekIndexForDayOffset(dayOffset: number): number {
  if (!Number.isInteger(dayOffset) || dayOffset < 0) {
    throw new RangeError(`Day offset must be a non-negative integer, received ${dayOffset}.`);
  }
  return Math.floor(dayOffset / DAYS_PER_WEEK) + 1;
}

/** The inclusive day-offset range of a 1-based week index. */
export function dayOffsetsForWeek(weekIndex: number): {
  readonly firstDayOffset: number;
  readonly lastDayOffset: number;
} {
  if (!Number.isInteger(weekIndex) || weekIndex < 1) {
    throw new RangeError(`Week index must be a positive integer, received ${weekIndex}.`);
  }
  const firstDayOffset = (weekIndex - 1) * DAYS_PER_WEEK;
  return { firstDayOffset, lastDayOffset: firstDayOffset + DAYS_PER_WEEK - 1 };
}

export { DAYS_PER_WEEK };
