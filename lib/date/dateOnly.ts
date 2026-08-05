/**
 * Date-only arithmetic for RoxPlan (DECISIONS.md D7).
 *
 * Training days have no time component. A `DateOnly` is a `YYYY-MM-DD` string,
 * and every operation here is calendar arithmetic on that string — never on a
 * wall-clock instant. Nothing in this module reads the system clock; `todayIn`
 * takes the instant as an argument so callers stay testable and the engine
 * stays pure.
 *
 * Internally we use UTC-based `Date` arithmetic. UTC has no daylight-saving
 * transitions, so "add one day" is always exactly 86,400,000ms and the civil
 * date never skips or repeats. Local-time `Date` arithmetic has neither
 * property, which is the failure D7 exists to prevent.
 */

/**
 * A calendar date with no time component, formatted `YYYY-MM-DD`.
 *
 * Branded so an arbitrary string cannot be passed where a validated date is
 * expected. Construct with {@link toDateOnly} or {@link dateOnlyFromParts}.
 */
export type DateOnly = string & { readonly __brand: 'DateOnly' };

/** ISO-8601 weekday numbering: Monday is 1, Sunday is 7. */
export const Weekday = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
} as const;

export type Weekday = (typeof Weekday)[keyof typeof Weekday];

export interface DateParts {
  readonly year: number;
  /** 1-12. Not the 0-11 that `Date` uses. */
  readonly month: number;
  /** 1-31. */
  readonly day: number;
}

/** Thrown when a value cannot be interpreted as a `YYYY-MM-DD` calendar date. */
export class InvalidDateOnlyError extends Error {
  constructor(readonly value: string) {
    super(`Not a valid YYYY-MM-DD date: ${JSON.stringify(value)}`);
    this.name = 'InvalidDateOnlyError';
  }
}

const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/**
 * True if `value` is a well-formed `YYYY-MM-DD` string naming a real calendar
 * date. Rejects impossible dates such as `2026-02-30` and `2025-02-29`.
 */
export function isDateOnly(value: string): value is DateOnly {
  const match = SHAPE.exec(value);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Round-trip through UTC: `Date` silently normalises overflow (Feb 30 becomes
  // Mar 2), so a date is real only if it survives the trip unchanged.
  const utc = new Date(Date.UTC(year, month - 1, day));
  // `Date.UTC` maps years 0-99 into 1900-1999, which would make every
  // four-digit year below 0100 fail the round-trip. Undo that remapping.
  if (year >= 0 && year <= 99) utc.setUTCFullYear(year);
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

/** Validates `value` as a `DateOnly`, or throws {@link InvalidDateOnlyError}. */
export function toDateOnly(value: string): DateOnly {
  if (!isDateOnly(value)) throw new InvalidDateOnlyError(value);
  return value;
}

/**
 * Builds a `DateOnly` from calendar parts, with `month` 1-12 and `day` 1-31.
 * Throws on values that do not name a real date rather than normalising them.
 */
export function dateOnlyFromParts({ year, month, day }: DateParts): DateOnly {
  // Deliberately not `Math.abs` — a negative part must produce a malformed
  // string that `toDateOnly` rejects, never a plausible-looking date. Without
  // this, month -1 would quietly pad to "01".
  const pad = (n: number, width: number): string => String(n).padStart(width, '0');

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new InvalidDateOnlyError(`${year}-${month}-${day}`);
  }
  if (year < 0 || year > 9999) throw new InvalidDateOnlyError(`${year}-${month}-${day}`);

  return toDateOnly(`${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`);
}

/** Decomposes a `DateOnly` into calendar parts, with `month` 1-12. */
export function dateOnlyToParts(date: DateOnly): DateParts {
  const match = SHAPE.exec(date);
  if (match === null) throw new InvalidDateOnlyError(date);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function toUtcMillis(date: DateOnly): number {
  const { year, month, day } = dateOnlyToParts(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMillis(millis: number): DateOnly {
  const utc = new Date(millis);
  return dateOnlyFromParts({
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  });
}

/**
 * Returns the date `days` after `date`. Negative values move backwards.
 *
 * This is the operation behind `Session.dayOffset`: a session's date is
 * `addDays(plan.startDate, session.dayOffset)`.
 */
export function addDays(date: DateOnly, days: number): DateOnly {
  if (!Number.isInteger(days)) {
    throw new RangeError(`days must be an integer, received ${days}`);
  }
  return fromUtcMillis(toUtcMillis(date) + days * MS_PER_DAY);
}

/**
 * Whole days from `from` to `to`. Positive when `to` is later.
 *
 * `differenceInDays(a, addDays(a, n)) === n` for every integer `n`.
 */
export function differenceInDays(from: DateOnly, to: DateOnly): number {
  return (toUtcMillis(to) - toUtcMillis(from)) / MS_PER_DAY;
}

/** Orders two dates: -1 if `a` is earlier, 0 if equal, 1 if `a` is later. */
export function compareDateOnly(a: DateOnly, b: DateOnly): -1 | 0 | 1 {
  // `YYYY-MM-DD` is fixed-width and zero-padded, so lexical order is
  // chronological order — but comparing the parsed values keeps the intent
  // obvious and survives any future change of format.
  const left = toUtcMillis(a);
  const right = toUtcMillis(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function isBefore(a: DateOnly, b: DateOnly): boolean {
  return compareDateOnly(a, b) === -1;
}

export function isAfter(a: DateOnly, b: DateOnly): boolean {
  return compareDateOnly(a, b) === 1;
}

/** The ISO weekday of `date`, Monday 1 through Sunday 7. */
export function weekdayOf(date: DateOnly): Weekday {
  const sundayZero = new Date(toUtcMillis(date)).getUTCDay();
  return (sundayZero === 0 ? 7 : sundayZero) as Weekday;
}

/**
 * The current calendar date in `timeZone`, resolved from the instant `now`.
 *
 * `now` is a parameter rather than an implicit `new Date()` so that callers
 * remain deterministic — the engine never reads the clock itself, and tests
 * can pin the instant.
 *
 * @param timeZone an IANA zone name, e.g. `Asia/Tokyo`
 * @throws RangeError if `timeZone` is not a recognised zone
 */
export function todayIn(timeZone: string, now: Date): DateOnly {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const find = (type: 'year' | 'month' | 'day'): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new RangeError(`Could not resolve ${type} in time zone ${timeZone}`);
    }
    return Number(part.value);
  };

  return dateOnlyFromParts({
    year: find('year'),
    month: find('month'),
    day: find('day'),
  });
}
