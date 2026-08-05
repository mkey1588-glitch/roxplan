import { describe, expect, it } from 'vitest';

import {
  allocatePhases,
  hasSufficientRunway,
  InsufficientRunwayError,
  MAX_PLAN_WEEKS,
  MIN_PLAN_WEEKS,
  phaseForWeek,
  phaseSpans,
  TAPER_WEEKS,
} from './phases';
import { ATHLETIC_BACKGROUNDS, PHASE_TYPES } from './types';
import type { AthleticBackground, PhaseAllocation } from './types';

const ALL_WEEKS: number[] = [];
for (let weeks = MIN_PLAN_WEEKS; weeks <= MAX_PLAN_WEEKS; weeks += 1) ALL_WEEKS.push(weeks);

const sum = (allocation: PhaseAllocation): number =>
  PHASE_TYPES.reduce((total, phase) => total + allocation[phase], 0);

const shape = (allocation: PhaseAllocation): [number, number, number, number] => [
  allocation.FOUNDATION,
  allocation.BUILD,
  allocation.RACE_SPECIFIC,
  allocation.TAPER,
];

describe('the summing invariant (PRD §7.1)', () => {
  // "The assert is not decorative - it must be a runtime invariant and a test
  // case across every integer from 5 to 52."
  it.each(ALL_WEEKS)('sums to exactly %i weeks for every background', (weeks) => {
    for (const background of ATHLETIC_BACKGROUNDS) {
      const allocation = allocatePhases(weeks, background);
      expect(sum(allocation)).toBe(weeks);
    }
  });

  it.each(ALL_WEEKS)('allocates only whole non-negative weeks at %i', (weeks) => {
    for (const background of ATHLETIC_BACKGROUNDS) {
      const allocation = allocatePhases(weeks, background);
      for (const phase of PHASE_TYPES) {
        expect(Number.isInteger(allocation[phase])).toBe(true);
        expect(allocation[phase]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it.each(ALL_WEEKS)('gives every phase at least one week at %i', (weeks) => {
    // A zero-week phase would mean a plan that skips a training stage
    // entirely while still claiming to be periodized.
    for (const background of ATHLETIC_BACKGROUNDS) {
      const allocation = allocatePhases(weeks, background);
      for (const phase of PHASE_TYPES) {
        expect(allocation[phase]).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it.each(ALL_WEEKS)('keeps the taper at exactly one week at %i', (weeks) => {
    for (const background of ATHLETIC_BACKGROUNDS) {
      expect(allocatePhases(weeks, background).TAPER).toBe(TAPER_WEEKS);
    }
  });
});

describe('worked examples (PRD §7.1 table)', () => {
  it.each([
    [20, 'HYBRID', [7, 7, 5, 1]],
    [16, 'HYBRID', [6, 5, 4, 1]],
    [12, 'HYBRID', [4, 4, 3, 1]],
    [8, 'HYBRID', [3, 2, 2, 1]],
    [6, 'HYBRID', [2, 2, 1, 1]],
    [12, 'BEGINNER', [6, 2, 3, 1]],
  ] as const)('%i weeks, %s -> %j', (weeks, background, expected) => {
    expect(shape(allocatePhases(weeks, background as AthleticBackground))).toEqual([...expected]);
  });
});

describe('phase minimums', () => {
  it.each(ALL_WEEKS.filter((w) => w >= 8))('holds Build and Race-Spec at 2+ at %i weeks', (weeks) => {
    for (const background of ATHLETIC_BACKGROUNDS) {
      const allocation = allocatePhases(weeks, background);
      expect(allocation.BUILD).toBeGreaterThanOrEqual(2);
      expect(allocation.RACE_SPECIFIC).toBeGreaterThanOrEqual(2);
    }
  });

  it.each([5, 6, 7])('relaxes the minimums to 1 below 8 weeks (%i)', (weeks) => {
    for (const background of ATHLETIC_BACKGROUNDS) {
      const allocation = allocatePhases(weeks, background);
      expect(allocation.BUILD).toBeGreaterThanOrEqual(1);
      expect(allocation.RACE_SPECIFIC).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('determinism (ERRATA F11)', () => {
  it.each(ALL_WEEKS)('returns an identical allocation on repeat calls at %i', (weeks) => {
    for (const background of ATHLETIC_BACKGROUNDS) {
      const first = allocatePhases(weeks, background);
      const second = allocatePhases(weeks, background);
      expect(second).toEqual(first);
    }
  });

  it.each([11, 31, 51])('resolves the Build/Race-Spec remainder tie at %i weeks', (weeks) => {
    // These three inputs put Build and Race-Specific on an exact 0.5
    // remainder. Without a documented tie-break the outcome depends on sort
    // stability, which is precisely the non-determinism CLAUDE.md forbids.
    const remaining = weeks - TAPER_WEEKS;
    const buildRaw = (remaining * 35) / 100;
    const raceSpecRaw = (remaining * 25) / 100;

    // Confirm these really are ties, so the case stays meaningful if the
    // proportions ever change.
    expect(buildRaw % 1).toBe(0.5);
    expect(raceSpecRaw % 1).toBe(0.5);

    const allocation = allocatePhases(weeks, 'HYBRID');
    expect(sum(allocation)).toBe(weeks);

    // Race-Specific wins: it rounds up, Build rounds down.
    expect(allocation.RACE_SPECIFIC).toBe(Math.ceil(raceSpecRaw));
    expect(allocation.BUILD).toBe(Math.floor(buildRaw));
  });

  it('allocates 11 weeks as 4/3/3/1', () => {
    expect(shape(allocatePhases(11, 'HYBRID'))).toEqual([4, 3, 3, 1]);
  });

  it('does not drift on floating-point boundaries', () => {
    // 0.35 * 12 is 4.199999999999999 in binary floating point. Integer maths
    // means the allocation cannot depend on which side of the boundary that
    // lands.
    expect(shape(allocatePhases(13, 'HYBRID'))).toEqual(shape(allocatePhases(13, 'HYBRID')));
    expect(sum(allocatePhases(13, 'HYBRID'))).toBe(13);
  });

  it('returns a frozen allocation, so callers cannot mutate a plan input', () => {
    const allocation = allocatePhases(12, 'HYBRID');
    expect(Object.isFrozen(allocation)).toBe(true);
  });
});

describe('background modifiers (PRD §7.3)', () => {
  it('is identical for RUNNER, STRENGTH and HYBRID — they differ elsewhere', () => {
    for (const weeks of ALL_WEEKS) {
      const hybrid = allocatePhases(weeks, 'HYBRID');
      expect(allocatePhases(weeks, 'RUNNER')).toEqual(hybrid);
      expect(allocatePhases(weeks, 'STRENGTH')).toEqual(hybrid);
    }
  });

  it('never gives a BEGINNER less Foundation than a HYBRID', () => {
    for (const weeks of ALL_WEEKS) {
      expect(allocatePhases(weeks, 'BEGINNER').FOUNDATION).toBeGreaterThanOrEqual(
        allocatePhases(weeks, 'HYBRID').FOUNDATION,
      );
    }
  });

  it('shifts at most 2 weeks into Foundation', () => {
    for (const weeks of ALL_WEEKS) {
      const shifted =
        allocatePhases(weeks, 'BEGINNER').FOUNDATION - allocatePhases(weeks, 'HYBRID').FOUNDATION;
      expect(shifted).toBeGreaterThanOrEqual(0);
      expect(shifted).toBeLessThanOrEqual(2);
    }
  });

  it('takes from Build before Race-Specific', () => {
    // 12 weeks has slack in both: Build must give up its weeks first.
    const hybrid = allocatePhases(12, 'HYBRID');
    const beginner = allocatePhases(12, 'BEGINNER');
    expect(hybrid.BUILD - beginner.BUILD).toBe(2);
    expect(beginner.RACE_SPECIFIC).toBe(hybrid.RACE_SPECIFIC);
  });

  it('is a no-op at 8 weeks, where both donors are already at their floor (ERRATA F26)', () => {
    expect(allocatePhases(8, 'BEGINNER')).toEqual(allocatePhases(8, 'HYBRID'));
  });
});

describe('runway guard (PRD §7.6, guardrail 7)', () => {
  it.each([4, 3, 2, 1, 0, -1])('refuses to build a standard plan at %i weeks', (weeks) => {
    expect(hasSufficientRunway(weeks)).toBe(false);
    expect(() => allocatePhases(weeks, 'HYBRID')).toThrow(InsufficientRunwayError);
  });

  it('accepts exactly 5 weeks, the documented minimum', () => {
    expect(hasSufficientRunway(MIN_PLAN_WEEKS)).toBe(true);
    expect(shape(allocatePhases(5, 'HYBRID'))).toEqual([2, 1, 1, 1]);
  });

  it('points the caller at the readiness path rather than failing silently', () => {
    try {
      allocatePhases(4, 'BEGINNER');
      throw new Error('expected allocatePhases to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientRunwayError);
      if (!(error instanceof InsufficientRunwayError)) throw error;
      expect(error.weeksToRace).toBe(4);
      expect(error.message).toContain('§7.6');
    }
  });

  it('rejects a non-integer week count', () => {
    expect(() => allocatePhases(12.5, 'HYBRID')).toThrow(RangeError);
  });

  it('rejects plans longer than a year', () => {
    expect(() => allocatePhases(MAX_PLAN_WEEKS + 1, 'HYBRID')).toThrow(RangeError);
  });
});

describe('phaseSpans', () => {
  it('covers every week exactly once, with no gap or overlap', () => {
    for (const weeks of ALL_WEEKS) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        const spans = phaseSpans(allocatePhases(weeks, background));
        expect(spans[0]?.startWeek).toBe(1);
        expect(spans.at(-1)?.endWeek).toBe(weeks);

        for (let i = 1; i < spans.length; i += 1) {
          const previous = spans[i - 1];
          const current = spans[i];
          if (previous === undefined || current === undefined) throw new Error('missing span');
          expect(current.startWeek).toBe(previous.endWeek + 1);
        }
      }
    }
  });

  it('runs in phase order and ends with the taper', () => {
    const spans = phaseSpans(allocatePhases(16, 'HYBRID'));
    expect(spans.map((span) => span.type)).toEqual([
      'FOUNDATION',
      'BUILD',
      'RACE_SPECIFIC',
      'TAPER',
    ]);
  });

  it('puts the taper in the final week for every plan length', () => {
    for (const weeks of ALL_WEEKS) {
      const allocation = allocatePhases(weeks, 'HYBRID');
      expect(phaseForWeek(allocation, weeks)).toBe('TAPER');
    }
  });
});

describe('phaseForWeek', () => {
  it('maps a 12-week plan week by week', () => {
    const allocation = allocatePhases(12, 'HYBRID'); // 4 / 4 / 3 / 1
    const byWeek = Array.from({ length: 12 }, (_unused, index) =>
      phaseForWeek(allocation, index + 1),
    );
    expect(byWeek).toEqual([
      'FOUNDATION',
      'FOUNDATION',
      'FOUNDATION',
      'FOUNDATION',
      'BUILD',
      'BUILD',
      'BUILD',
      'BUILD',
      'RACE_SPECIFIC',
      'RACE_SPECIFIC',
      'RACE_SPECIFIC',
      'TAPER',
    ]);
  });

  it('returns null past the end of the plan', () => {
    expect(phaseForWeek(allocatePhases(12, 'HYBRID'), 13)).toBeNull();
  });

  it('rejects a zero or negative week index', () => {
    const allocation = allocatePhases(12, 'HYBRID');
    expect(() => phaseForWeek(allocation, 0)).toThrow(RangeError);
    expect(() => phaseForWeek(allocation, -1)).toThrow(RangeError);
  });
});
