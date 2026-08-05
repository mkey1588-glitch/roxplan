import { describe, expect, it } from 'vitest';

import {
  addDays,
  compareDateOnly,
  dateOnlyFromParts,
  dateOnlyToParts,
  differenceInDays,
  InvalidDateOnlyError,
  isAfter,
  isBefore,
  isDateOnly,
  toDateOnly,
  todayIn,
  Weekday,
  weekdayOf,
} from './dateOnly';

describe('isDateOnly', () => {
  it.each(['2026-01-01', '2026-12-31', '2024-02-29', '2000-02-29', '1999-06-15'])(
    'accepts %s',
    (value) => {
      expect(isDateOnly(value)).toBe(true);
    },
  );

  it.each([
    ['2026-02-30', 'a day that does not exist in that month'],
    ['2025-02-29', 'Feb 29 in a non-leap year'],
    ['1900-02-29', 'Feb 29 in a century year that is not a leap year'],
    ['2026-13-01', 'month 13'],
    ['2026-00-10', 'month 0'],
    ['2026-04-31', 'April 31'],
    ['2026-1-01', 'an unpadded month'],
    ['2026-01-1', 'an unpadded day'],
    ['26-01-01', 'a two-digit year'],
    ['2026/01/01', 'slash separators'],
    ['2026-01-01T00:00:00Z', 'a time component'],
    ['', 'an empty string'],
    ['not a date', 'arbitrary text'],
  ])('rejects %s (%s)', (value) => {
    expect(isDateOnly(value)).toBe(false);
  });
});

describe('toDateOnly', () => {
  it('returns the value unchanged when valid', () => {
    expect(toDateOnly('2026-08-15')).toBe('2026-08-15');
  });

  it('throws InvalidDateOnlyError rather than normalising an impossible date', () => {
    expect(() => toDateOnly('2026-02-30')).toThrow(InvalidDateOnlyError);
  });
});

describe('dateOnlyFromParts / dateOnlyToParts', () => {
  it('zero-pads single-digit months and days', () => {
    expect(dateOnlyFromParts({ year: 2026, month: 3, day: 7 })).toBe('2026-03-07');
  });

  it('uses 1-12 for month, not the 0-11 that Date uses', () => {
    expect(dateOnlyToParts(toDateOnly('2026-01-31'))).toEqual({
      year: 2026,
      month: 1,
      day: 31,
    });
  });

  it('round-trips', () => {
    const original = toDateOnly('2026-11-09');
    expect(dateOnlyFromParts(dateOnlyToParts(original))).toBe(original);
  });

  it('rejects overflowing parts instead of silently normalising them', () => {
    expect(() => dateOnlyFromParts({ year: 2026, month: 2, day: 30 })).toThrow(
      InvalidDateOnlyError,
    );
    expect(() => dateOnlyFromParts({ year: 2026, month: 13, day: 1 })).toThrow(
      InvalidDateOnlyError,
    );
  });

  it('rejects negative parts rather than padding them into a plausible date', () => {
    // Without care, month -1 pads to "01" and yields a silently wrong date.
    expect(() => dateOnlyFromParts({ year: 2026, month: -1, day: 5 })).toThrow(
      InvalidDateOnlyError,
    );
    expect(() => dateOnlyFromParts({ year: 2026, month: 8, day: -5 })).toThrow(
      InvalidDateOnlyError,
    );
    expect(() => dateOnlyFromParts({ year: -2026, month: 8, day: 5 })).toThrow(
      InvalidDateOnlyError,
    );
  });

  it('rejects non-integer parts', () => {
    expect(() => dateOnlyFromParts({ year: 2026, month: 8.5, day: 5 })).toThrow(
      InvalidDateOnlyError,
    );
  });
});

describe('addDays', () => {
  it('advances within a month', () => {
    expect(addDays(toDateOnly('2026-08-05'), 3)).toBe('2026-08-08');
  });

  it('crosses a month boundary', () => {
    expect(addDays(toDateOnly('2026-08-30'), 3)).toBe('2026-09-02');
  });

  it('crosses a year boundary', () => {
    expect(addDays(toDateOnly('2026-12-30'), 5)).toBe('2027-01-04');
  });

  it('crosses a leap day', () => {
    expect(addDays(toDateOnly('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(toDateOnly('2024-02-28'), 2)).toBe('2024-03-01');
  });

  it('skips Feb 29 in a non-leap year', () => {
    expect(addDays(toDateOnly('2026-02-28'), 1)).toBe('2026-03-01');
  });

  it('moves backwards on a negative count', () => {
    expect(addDays(toDateOnly('2026-03-01'), -1)).toBe('2026-02-28');
  });

  it('is identity for zero', () => {
    expect(addDays(toDateOnly('2026-08-05'), 0)).toBe('2026-08-05');
  });

  it('rejects a fractional day count', () => {
    expect(() => addDays(toDateOnly('2026-08-05'), 1.5)).toThrow(RangeError);
  });

  it('spans a full plan without drift', () => {
    // 52 weeks is the longest plan the engine supports.
    expect(addDays(toDateOnly('2026-01-01'), 364)).toBe('2026-12-31');
  });

  it('does not drift across a daylight-saving transition', () => {
    // 2026-03-08 is the US spring-forward date; 2026-10-25 is the EU
    // fall-back date. Both are 23- or 25-hour local days, and neither may
    // affect calendar arithmetic.
    expect(addDays(toDateOnly('2026-03-07'), 1)).toBe('2026-03-08');
    expect(addDays(toDateOnly('2026-03-08'), 1)).toBe('2026-03-09');
    expect(addDays(toDateOnly('2026-10-24'), 1)).toBe('2026-10-25');
    expect(addDays(toDateOnly('2026-10-25'), 1)).toBe('2026-10-26');
  });
});

describe('differenceInDays', () => {
  it('is positive when the second date is later', () => {
    expect(differenceInDays(toDateOnly('2026-08-05'), toDateOnly('2026-08-12'))).toBe(7);
  });

  it('is negative when the second date is earlier', () => {
    expect(differenceInDays(toDateOnly('2026-08-12'), toDateOnly('2026-08-05'))).toBe(-7);
  });

  it('is zero for the same date', () => {
    expect(differenceInDays(toDateOnly('2026-08-05'), toDateOnly('2026-08-05'))).toBe(0);
  });

  it('counts leap days', () => {
    expect(differenceInDays(toDateOnly('2024-02-28'), toDateOnly('2024-03-01'))).toBe(2);
    expect(differenceInDays(toDateOnly('2026-02-28'), toDateOnly('2026-03-01'))).toBe(1);
  });

  it('inverts addDays for every offset in a year-long plan', () => {
    const start = toDateOnly('2026-01-01');
    for (let offset = -400; offset <= 400; offset += 1) {
      expect(differenceInDays(start, addDays(start, offset))).toBe(offset);
    }
  });
});

describe('compareDateOnly / isBefore / isAfter', () => {
  const earlier = toDateOnly('2026-08-05');
  const later = toDateOnly('2026-08-06');

  it('orders two dates', () => {
    expect(compareDateOnly(earlier, later)).toBe(-1);
    expect(compareDateOnly(later, earlier)).toBe(1);
    expect(compareDateOnly(earlier, earlier)).toBe(0);
  });

  it('sorts chronologically', () => {
    const dates = [
      toDateOnly('2026-12-31'),
      toDateOnly('2026-01-01'),
      toDateOnly('2027-01-01'),
      toDateOnly('2026-06-15'),
    ];
    expect([...dates].sort(compareDateOnly)).toEqual([
      '2026-01-01',
      '2026-06-15',
      '2026-12-31',
      '2027-01-01',
    ]);
  });

  it('exposes readable predicates', () => {
    expect(isBefore(earlier, later)).toBe(true);
    expect(isBefore(later, earlier)).toBe(false);
    expect(isAfter(later, earlier)).toBe(true);
    expect(isAfter(earlier, earlier)).toBe(false);
  });
});

describe('weekdayOf', () => {
  it('numbers Monday 1 through Sunday 7 (ISO-8601)', () => {
    // 2026-08-03 is a Monday.
    expect(weekdayOf(toDateOnly('2026-08-03'))).toBe(Weekday.MONDAY);
    expect(weekdayOf(toDateOnly('2026-08-04'))).toBe(Weekday.TUESDAY);
    expect(weekdayOf(toDateOnly('2026-08-05'))).toBe(Weekday.WEDNESDAY);
    expect(weekdayOf(toDateOnly('2026-08-06'))).toBe(Weekday.THURSDAY);
    expect(weekdayOf(toDateOnly('2026-08-07'))).toBe(Weekday.FRIDAY);
    expect(weekdayOf(toDateOnly('2026-08-08'))).toBe(Weekday.SATURDAY);
    expect(weekdayOf(toDateOnly('2026-08-09'))).toBe(Weekday.SUNDAY);
  });

  it('never returns 0, so Sunday cannot be confused with a falsy value', () => {
    const start = toDateOnly('2026-01-01');
    for (let offset = 0; offset < 366; offset += 1) {
      const weekday = weekdayOf(addDays(start, offset));
      expect(weekday).toBeGreaterThanOrEqual(1);
      expect(weekday).toBeLessThanOrEqual(7);
    }
  });
});

describe('todayIn', () => {
  it('resolves the instant against the given zone', () => {
    // 2026-08-05 14:30 UTC is still the 5th in London, already the 5th
    // (23:30) in Tokyo, and still the 5th (07:30) in Los Angeles.
    const instant = new Date('2026-08-05T14:30:00Z');
    expect(todayIn('UTC', instant)).toBe('2026-08-05');
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-08-05');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-08-05');
  });

  it('gives different calendar dates either side of the date line', () => {
    // 22:00 UTC is already tomorrow in Tokyo (07:00 next day) but still
    // today in Los Angeles (15:00). This is the case D7 exists for: a user
    // in Japan racing in Europe must not see the wrong day's session.
    const instant = new Date('2026-08-05T22:00:00Z');
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-08-06');
    expect(todayIn('Europe/London', instant)).toBe('2026-08-05');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-08-05');
  });

  it('handles a zone that is ahead by a fractional offset', () => {
    // Kathmandu is UTC+05:45.
    const instant = new Date('2026-08-05T18:20:00Z');
    expect(todayIn('Asia/Kathmandu', instant)).toBe('2026-08-06');
  });

  it('reports the local date during a daylight-saving transition', () => {
    // 2026-03-08 09:00 UTC is 01:00 PST, an hour before the US spring
    // forward, and 02:00 PDT immediately after it.
    expect(todayIn('America/Los_Angeles', new Date('2026-03-08T09:00:00Z'))).toBe(
      '2026-03-08',
    );
    expect(todayIn('America/Los_Angeles', new Date('2026-03-08T11:00:00Z'))).toBe(
      '2026-03-08',
    );
  });

  it('throws on an unrecognised zone', () => {
    expect(() => todayIn('Not/AZone', new Date('2026-08-05T00:00:00Z'))).toThrow(
      RangeError,
    );
  });

  it('does not read the system clock', () => {
    const instant = new Date('2026-08-05T12:00:00Z');
    expect(todayIn('UTC', instant)).toBe(todayIn('UTC', instant));
  });
});
