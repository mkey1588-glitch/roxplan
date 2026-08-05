import { describe, expect, it } from 'vitest';

import { allocatePhases } from '../phases';
import { ATHLETIC_BACKGROUNDS } from '../types';
import type { AthleticBackground } from '../types';

import {
  ceilingFactorFor,
  DELOAD_VOLUME_FACTOR,
  isDeloadWeek,
  planWeeklyVolume,
  ROLLING_MAX_WEEKS,
  RUNNER_VOLUME_CEILING_FACTOR,
  VOLUME_CEILING_FACTOR,
} from './volume';

const plan = (
  weeks: number,
  background: AthleticBackground = 'HYBRID',
  currentWeeklyRunM = 20000,
  baselineConfidence: 'HIGH' | 'LOW' = 'HIGH',
) =>
  planWeeklyVolume({
    weeks,
    allocation: allocatePhases(weeks, background),
    background,
    currentWeeklyRunM,
    baselineConfidence,
  });

/** Guardrail 1, applied exactly as the validator will apply it. */
function assertCeilingHolds(
  weeks: readonly { runningBudgetM: number }[],
  ceilingFactor: number,
): void {
  for (let i = 1; i < weeks.length; i += 1) {
    const window = weeks.slice(Math.max(0, i - ROLLING_MAX_WEEKS), i);
    const rollingMax = Math.max(...window.map((week) => week.runningBudgetM));
    const current = weeks[i];
    if (current === undefined) throw new Error('missing week');
    expect(current.runningBudgetM).toBeLessThanOrEqual(Math.round(rollingMax * ceilingFactor) + 1);
  }
}

describe('guardrail 1 holds by construction (ERRATA R2)', () => {
  it('never exceeds 110% of the 3-week rolling max, at any plan length', () => {
    for (let weeks = 5; weeks <= 52; weeks += 1) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        assertCeilingHolds(plan(weeks, background), ceilingFactorFor(background));
      }
    }
  });

  it('holds RUNNER profiles to the tighter 105% ceiling', () => {
    expect(ceilingFactorFor('RUNNER')).toBe(RUNNER_VOLUME_CEILING_FACTOR);
    for (const background of ['STRENGTH', 'HYBRID', 'BEGINNER'] as const) {
      expect(ceilingFactorFor(background)).toBe(VOLUME_CEILING_FACTOR);
    }
    assertCeilingHolds(plan(20, 'RUNNER'), RUNNER_VOLUME_CEILING_FACTOR);
  });

  it('anchors week 1 to the athlete’s actual current volume (ERRATA R3)', () => {
    expect(plan(12, 'HYBRID', 18000)[0]?.runningBudgetM).toBe(18000);
  });

  it('starts a self-reported baseline 15% lower (D2)', () => {
    const high = plan(12, 'HYBRID', 20000, 'HIGH')[0]?.runningBudgetM;
    const low = plan(12, 'HYBRID', 20000, 'LOW')[0]?.runningBudgetM;
    expect(high).toBe(20000);
    expect(low).toBe(17000);
  });

  it('never prescribes negative or fractional metres', () => {
    for (let weeks = 5; weeks <= 52; weeks += 1) {
      for (const week of plan(weeks)) {
        expect(week.runningBudgetM).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(week.runningBudgetM)).toBe(true);
      }
    }
  });
});

describe('deloads (guardrail 3)', () => {
  it('lands every 4th week counted from plan start (ERRATA F16)', () => {
    const weeks = plan(20);
    const deloads = weeks.filter((week) => week.isDeload).map((week) => week.weekIndex);
    for (const weekIndex of deloads) expect(weekIndex % 4).toBe(0);
  });

  it('cuts volume by 40%', () => {
    const weeks = plan(20);
    const deload = weeks.find((week) => week.isDeload);
    if (deload === undefined) throw new Error('expected a deload week');

    const priorMax = Math.max(
      ...weeks
        .filter((w) => w.weekIndex < deload.weekIndex && w.weekIndex >= deload.weekIndex - 3)
        .map((w) => w.runningBudgetM),
    );
    expect(deload.runningBudgetM).toBe(Math.round(priorMax * DELOAD_VOLUME_FACTOR));
  });

  it('is suppressed in Race-Specific and Taper', () => {
    for (let weeks = 5; weeks <= 52; weeks += 1) {
      for (const week of plan(weeks)) {
        if (week.phase === 'RACE_SPECIFIC' || week.phase === 'TAPER') {
          expect(week.isDeload).toBe(false);
        }
      }
    }
  });

  it('is suppressed within 3 weeks of race day, inclusive', () => {
    for (let weeks = 5; weeks <= 52; weeks += 1) {
      const weekPlan = plan(weeks);
      for (const week of weekPlan) {
        if (weeks - week.weekIndex <= 3) expect(week.isDeload).toBe(false);
      }
    }
  });

  it('never puts two easy weeks back to back before the race', () => {
    // The bug F8.3 exists to prevent: a deload landing next to the taper.
    for (let weeks = 5; weeks <= 52; weeks += 1) {
      const weekPlan = plan(weeks);
      const taperIndex = weekPlan.findIndex((week) => week.phase === 'TAPER');
      if (taperIndex <= 0) continue;
      expect(weekPlan[taperIndex - 1]?.isDeload).toBe(false);
    }
  });

  it('drops a suppressed deload rather than deferring it', () => {
    // Deferring would push it into the window the suppression protects.
    expect(isDeloadWeek(4, 'RACE_SPECIFIC', 20)).toBe(false);
    expect(isDeloadWeek(5, 'BUILD', 20)).toBe(false); // not a 4th week
  });

  it('lets volume return to full after a deload — the v0.1 deadlock', () => {
    const weeks = plan(20);
    const deload = weeks.find((week) => week.isDeload);
    if (deload === undefined) throw new Error('expected a deload week');
    const after = weeks.find((week) => week.weekIndex === deload.weekIndex + 1);
    if (after === undefined) throw new Error('expected a week after the deload');

    // The whole point of the 3-week rolling max: measuring from the deload
    // week itself would trap the athlete at the reduced load.
    expect(after.runningBudgetM).toBeGreaterThan(deload.runningBudgetM * 1.5);
  });
});

describe('phase behaviour', () => {
  it('grows through Foundation and Build', () => {
    const weeks = plan(20).filter((week) => !week.isDeload);
    const foundation = weeks.filter((week) => week.phase === 'FOUNDATION');
    expect(foundation.length).toBeGreaterThan(1);

    const first = foundation[0];
    const last = foundation.at(-1);
    if (first === undefined || last === undefined) throw new Error('missing weeks');
    expect(last.runningBudgetM).toBeGreaterThan(first.runningBudgetM);
  });

  it('holds volume steady in Race-Specific rather than growing it', () => {
    const raceSpecific = plan(20).filter((week) => week.phase === 'RACE_SPECIFIC');
    const budgets = raceSpecific.map((week) => week.runningBudgetM);
    for (const budget of budgets) expect(budget).toBe(budgets[0]);
  });

  it('cuts the taper by 40-50% (§7.2)', () => {
    const weeks = plan(20);
    const taper = weeks.find((week) => week.phase === 'TAPER');
    const beforeTaper = weeks.filter((week) => week.phase === 'RACE_SPECIFIC');
    if (taper === undefined) throw new Error('expected a taper week');

    const priorMax = Math.max(...beforeTaper.map((week) => week.runningBudgetM));
    const remaining = taper.runningBudgetM / priorMax;
    expect(remaining).toBeGreaterThanOrEqual(0.5);
    expect(remaining).toBeLessThanOrEqual(0.6);
  });

  it('always tapers, at every plan length', () => {
    for (let weeks = 5; weeks <= 52; weeks += 1) {
      const weekPlan = plan(weeks);
      const taper = weekPlan.at(-1);
      const previous = weekPlan.at(-2);
      if (taper === undefined || previous === undefined) throw new Error('missing weeks');
      expect(taper.phase).toBe('TAPER');
      expect(taper.runningBudgetM).toBeLessThan(previous.runningBudgetM);
    }
  });
});

describe('determinism', () => {
  it('produces an identical plan for identical inputs', () => {
    for (let weeks = 5; weeks <= 30; weeks += 1) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        expect(plan(weeks, background)).toEqual(plan(weeks, background));
      }
    }
  });

  it('covers every week exactly once, in order', () => {
    for (let weeks = 5; weeks <= 52; weeks += 1) {
      const indices = plan(weeks).map((week) => week.weekIndex);
      expect(indices).toEqual(Array.from({ length: weeks }, (_unused, i) => i + 1));
    }
  });

  it('rejects invalid input', () => {
    const valid = {
      allocation: allocatePhases(12, 'HYBRID'),
      background: 'HYBRID' as const,
      currentWeeklyRunM: 20000,
      baselineConfidence: 'HIGH' as const,
    };
    expect(() => planWeeklyVolume({ ...valid, weeks: 0 })).toThrow(RangeError);
    expect(() => planWeeklyVolume({ ...valid, weeks: 12, currentWeeklyRunM: -1 })).toThrow(
      RangeError,
    );
  });
});
