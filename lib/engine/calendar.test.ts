import { describe, expect, it } from 'vitest';

import { addDays, differenceInDays, toDateOnly, weekdayOf } from '@/lib/date/dateOnly';

import {
  DAYS_PER_WEEK,
  DayOffsetOutOfRangeError,
  dateForDayOffset,
  dayOffsetForDate,
  dayOffsetsForWeek,
  deriveRaceCalendar,
  deriveRollingCalendar,
  isLeadInDate,
  isWithinPlan,
  RaceDateInPastError,
  raceDayOffset,
  totalDays,
  weekIndexForDayOffset,
} from './calendar';

const TODAY = toDateOnly('2026-08-05');

describe('deriveRaceCalendar (ERRATA R1)', () => {
  it('puts race day on the final day of the plan', () => {
    const raceDate = addDays(TODAY, 83);
    const calendar = deriveRaceCalendar(TODAY, raceDate);
    const lastOffset = totalDays(calendar) - 1;

    expect(raceDayOffset(calendar)).toBe(lastOffset);
    expect(dateForDayOffset(calendar, lastOffset)).toBe(raceDate);
  });

  it('holds the anchoring identity for every horizon up to a year', () => {
    for (let daysOut = 0; daysOut <= 400; daysOut += 1) {
      const raceDate = addDays(TODAY, daysOut);
      const calendar = deriveRaceCalendar(TODAY, raceDate);

      // Race day is the last day of the last week.
      expect(addDays(calendar.startDate, calendar.weeks * DAYS_PER_WEEK - 1)).toBe(raceDate);
      // The lead-in exactly bridges today and the start date.
      expect(differenceInDays(TODAY, calendar.startDate)).toBe(calendar.leadInDays);
    }
  });

  it('keeps the lead-in in the 0-6 range R1 specifies', () => {
    for (let daysOut = 0; daysOut <= 400; daysOut += 1) {
      const calendar = deriveRaceCalendar(TODAY, addDays(TODAY, daysOut));
      expect(calendar.leadInDays).toBeGreaterThanOrEqual(0);
      expect(calendar.leadInDays).toBeLessThanOrEqual(6);
    }
  });

  it('starts today when the horizon is a whole number of weeks', () => {
    for (const weeks of [5, 8, 12, 16, 20]) {
      // Inclusive counting: a 12-week plan needs 84 days including race day,
      // so the race is 83 days after today.
      const calendar = deriveRaceCalendar(TODAY, addDays(TODAY, weeks * DAYS_PER_WEEK - 1));
      expect(calendar.weeks).toBe(weeks);
      expect(calendar.leadInDays).toBe(0);
      expect(calendar.startDate).toBe(TODAY);
    }
  });

  it('does not discard a usable training week (ERRATA F30)', () => {
    // A race 13 days out leaves 14 usable days, which is two whole weeks.
    // The PRD's exclusive floor(13/7) would give a 1-week plan with a 7-day
    // lead-in, silently throwing away a training week.
    const calendar = deriveRaceCalendar(TODAY, addDays(TODAY, 13));
    expect(calendar.weeks).toBe(2);
    expect(calendar.leadInDays).toBe(0);
  });

  it('never leaves a lead-in long enough to have been another week', () => {
    for (let daysOut = 0; daysOut <= 400; daysOut += 1) {
      const calendar = deriveRaceCalendar(TODAY, addDays(TODAY, daysOut));
      expect(calendar.leadInDays).toBeLessThan(DAYS_PER_WEEK);
    }
  });

  it('grows the plan by one week for every seven days of extra runway', () => {
    let previous = deriveRaceCalendar(TODAY, addDays(TODAY, 0)).weeks;
    for (let daysOut = 1; daysOut <= 200; daysOut += 1) {
      const weeks = deriveRaceCalendar(TODAY, addDays(TODAY, daysOut)).weeks;
      // Monotonic, and never jumps by more than one.
      expect(weeks).toBeGreaterThanOrEqual(previous);
      expect(weeks - previous).toBeLessThanOrEqual(1);
      previous = weeks;
    }
  });

  it('handles a race today as zero whole weeks rather than an error', () => {
    const calendar = deriveRaceCalendar(TODAY, TODAY);
    expect(calendar.weeks).toBe(0);
    expect(calendar.leadInDays).toBe(1);
  });

  it('throws when the race has already happened (ERRATA F27)', () => {
    expect(() => deriveRaceCalendar(TODAY, addDays(TODAY, -1))).toThrow(RaceDateInPastError);
  });

  it('is unaffected by which weekday the race falls on', () => {
    // Plan weeks are 7-day windows anchored to race day, not Monday-Sunday,
    // so a Saturday race and a Wednesday race behave identically.
    const weekdaysSeen = new Set<number>();
    for (let daysOut = 76; daysOut <= 82; daysOut += 1) {
      const raceDate = addDays(TODAY, daysOut);
      weekdaysSeen.add(weekdayOf(raceDate));
      const calendar = deriveRaceCalendar(TODAY, raceDate);
      expect(dateForDayOffset(calendar, totalDays(calendar) - 1)).toBe(raceDate);
    }
    expect(weekdaysSeen.size).toBe(7);
  });
});

describe('deriveRollingCalendar (DECISIONS.md D4)', () => {
  it('starts today with no race date and no lead-in', () => {
    const calendar = deriveRollingCalendar(TODAY, 4);
    expect(calendar.startDate).toBe(TODAY);
    expect(calendar.raceDate).toBeNull();
    expect(calendar.leadInDays).toBe(0);
    expect(calendar.weeks).toBe(4);
  });

  it('has no race day offset', () => {
    expect(raceDayOffset(deriveRollingCalendar(TODAY, 4))).toBeNull();
  });

  it('rejects a zero or fractional week count', () => {
    expect(() => deriveRollingCalendar(TODAY, 0)).toThrow(RangeError);
    expect(() => deriveRollingCalendar(TODAY, 2.5)).toThrow(RangeError);
  });
});

describe('day offsets and dates', () => {
  const calendar = deriveRaceCalendar(TODAY, addDays(TODAY, 83)); // 12 weeks, no lead-in

  it('round-trips every day of the plan', () => {
    for (let offset = 0; offset < totalDays(calendar); offset += 1) {
      expect(dayOffsetForDate(calendar, dateForDayOffset(calendar, offset))).toBe(offset);
    }
  });

  it('rejects offsets outside the plan', () => {
    expect(() => dateForDayOffset(calendar, -1)).toThrow(DayOffsetOutOfRangeError);
    expect(() => dateForDayOffset(calendar, totalDays(calendar))).toThrow(
      DayOffsetOutOfRangeError,
    );
    expect(() => dateForDayOffset(calendar, 1.5)).toThrow(DayOffsetOutOfRangeError);
  });

  it('recognises dates inside and outside the plan', () => {
    expect(isWithinPlan(calendar, calendar.startDate)).toBe(true);
    expect(isWithinPlan(calendar, addDays(calendar.startDate, -1))).toBe(false);
    expect(isWithinPlan(calendar, addDays(calendar.startDate, totalDays(calendar)))).toBe(false);
  });

  it('recognises lead-in dates as outside the plan but before it', () => {
    const withLeadIn = deriveRaceCalendar(TODAY, addDays(TODAY, 87)); // 4 lead-in days
    expect(withLeadIn.leadInDays).toBe(4);

    for (let back = 1; back <= withLeadIn.leadInDays; back += 1) {
      const date = addDays(withLeadIn.startDate, -back);
      expect(isLeadInDate(withLeadIn, date)).toBe(true);
      expect(isWithinPlan(withLeadIn, date)).toBe(false);
    }

    expect(isLeadInDate(withLeadIn, addDays(withLeadIn.startDate, -5))).toBe(false);
    expect(isLeadInDate(withLeadIn, withLeadIn.startDate)).toBe(false);
  });
});

describe('week indexing', () => {
  it('is 1-based and seven days wide', () => {
    expect(weekIndexForDayOffset(0)).toBe(1);
    expect(weekIndexForDayOffset(6)).toBe(1);
    expect(weekIndexForDayOffset(7)).toBe(2);
    expect(weekIndexForDayOffset(83)).toBe(12);
  });

  it('agrees with dayOffsetsForWeek in both directions', () => {
    for (let week = 1; week <= 52; week += 1) {
      const { firstDayOffset, lastDayOffset } = dayOffsetsForWeek(week);
      expect(lastDayOffset - firstDayOffset).toBe(6);
      expect(weekIndexForDayOffset(firstDayOffset)).toBe(week);
      expect(weekIndexForDayOffset(lastDayOffset)).toBe(week);
    }
  });

  it('puts race day in the final week', () => {
    for (const weeks of [5, 8, 12, 16, 20, 52]) {
      const calendar = deriveRaceCalendar(TODAY, addDays(TODAY, weeks * DAYS_PER_WEEK - 1));
      const offset = raceDayOffset(calendar);
      if (offset === null) throw new Error('expected a race day');
      expect(weekIndexForDayOffset(offset)).toBe(weeks);
    }
  });

  it('rejects invalid indices', () => {
    expect(() => weekIndexForDayOffset(-1)).toThrow(RangeError);
    expect(() => weekIndexForDayOffset(1.5)).toThrow(RangeError);
    expect(() => dayOffsetsForWeek(0)).toThrow(RangeError);
  });
});
