import { describe, expect, it } from 'vitest';

import { DIVISIONS } from '@/lib/seeds/types';

import {
  assertSupportedDivision,
  isSupportedDivision,
  SUPPORTED_DIVISIONS,
  UnsupportedDivisionError,
} from './errors';

describe('supported divisions (DECISIONS.md D1)', () => {
  it('supports the two Singles divisions only', () => {
    expect([...SUPPORTED_DIVISIONS]).toEqual(['OPEN_SINGLES', 'PRO_SINGLES']);
  });

  it.each(['OPEN_SINGLES', 'PRO_SINGLES'] as const)('accepts %s', (division) => {
    expect(isSupportedDivision(division)).toBe(true);
    expect(() => assertSupportedDivision(division)).not.toThrow();
  });

  it.each(['DOUBLES', 'MIXED_DOUBLES', 'RELAY'] as const)(
    'throws for %s rather than silently generating a Singles plan',
    (division) => {
      expect(isSupportedDivision(division)).toBe(false);
      expect(() => assertSupportedDivision(division)).toThrow(UnsupportedDivisionError);
    },
  );

  it('names the offending division and the alternatives in the message', () => {
    try {
      assertSupportedDivision('DOUBLES');
      throw new Error('expected assertSupportedDivision to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedDivisionError);
      if (!(error instanceof UnsupportedDivisionError)) throw error;
      expect(error.division).toBe('DOUBLES');
      expect(error.name).toBe('UnsupportedDivisionError');
      expect(error.message).toContain('DOUBLES');
      expect(error.message).toContain('OPEN_SINGLES');
    }
  });

  it('classifies every division in the enum, leaving none undecided', () => {
    const supported = DIVISIONS.filter(isSupportedDivision);
    const rejected = DIVISIONS.filter((division) => !isSupportedDivision(division));
    expect(supported).toHaveLength(2);
    expect(rejected).toHaveLength(3);
    expect(supported.length + rejected.length).toBe(DIVISIONS.length);
  });
});
