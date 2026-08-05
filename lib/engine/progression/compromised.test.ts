import { describe, expect, it } from 'vitest';

import { ATHLETIC_BACKGROUNDS, PHASE_TYPES } from '../types';
import type { AthleticBackground } from '../types';

import { compromisedRunFor, compromisedRunningMetres } from './compromised';

const ctx = (
  phase: (typeof PHASE_TYPES)[number],
  weekInPhase: number,
  weeksInPhase: number,
  background: AthleticBackground = 'HYBRID',
) => ({ phase, weekInPhase, weeksInPhase, background });

describe('Foundation (PRD §7.7)', () => {
  it('does not prescribe compromised running', () => {
    for (let week = 1; week <= 6; week += 1) {
      expect(compromisedRunFor(ctx('FOUNDATION', week, 6))).toBeNull();
    }
  });

  it.each(['RUNNER', 'HYBRID', 'BEGINNER'] as const)('stays null for %s', (background) => {
    for (let week = 1; week <= 4; week += 1) {
      expect(compromisedRunFor(ctx('FOUNDATION', week, 4, background))).toBeNull();
    }
  });
});

describe('STRENGTH background gets it a week early (ERRATA F10)', () => {
  it('prescribes it in the final Foundation week only', () => {
    expect(compromisedRunFor(ctx('FOUNDATION', 3, 4, 'STRENGTH'))).toBeNull();
    expect(compromisedRunFor(ctx('FOUNDATION', 4, 4, 'STRENGTH'))).not.toBeNull();
  });

  it('gives them the Build week 1 prescription, not something heavier', () => {
    expect(compromisedRunFor(ctx('FOUNDATION', 4, 4, 'STRENGTH'))).toEqual(
      compromisedRunFor(ctx('BUILD', 1, 4, 'STRENGTH')),
    );
  });

  it('resolves the §7.3 / §7.7 contradiction rather than leaving it', () => {
    // §7.3 says "one week earlier"; §7.7 says Foundation is not prescribed.
    // The final Foundation week is the only reading that satisfies both.
    const others = (['RUNNER', 'HYBRID', 'BEGINNER'] as const).map((background) =>
      compromisedRunFor(ctx('FOUNDATION', 4, 4, background)),
    );
    expect(others.every((prescription) => prescription === null)).toBe(true);
  });
});

describe('Build progression (PRD §7.7)', () => {
  it('starts at 1 station then 400m, 3 rounds', () => {
    for (const week of [1, 2]) {
      expect(compromisedRunFor(ctx('BUILD', week, 5))).toEqual({
        stationsPerRound: 1,
        runDistanceM: 400,
        rounds: 3,
        zone: 'THRESHOLD',
        raceOrderSequence: false,
      });
    }
  });

  it('doubles the run to 800m from week 3', () => {
    const week3 = compromisedRunFor(ctx('BUILD', 3, 5));
    expect(week3?.runDistanceM).toBe(800);
    expect(week3?.stationsPerRound).toBe(1);
  });

  it('resolves "3-4 rounds" to 3 then 4, so volume still progresses (ERRATA F33)', () => {
    expect(compromisedRunFor(ctx('BUILD', 3, 6))?.rounds).toBe(3);
    expect(compromisedRunFor(ctx('BUILD', 4, 6))?.rounds).toBe(4);
    expect(compromisedRunFor(ctx('BUILD', 5, 6))?.rounds).toBe(4);
  });

  it('never decreases running volume from one Build week to the next', () => {
    let previous = 0;
    for (let week = 1; week <= 6; week += 1) {
      const prescription = compromisedRunFor(ctx('BUILD', week, 6));
      if (prescription === null) throw new Error('expected a Build prescription');
      const metres = compromisedRunningMetres(prescription);
      expect(metres).toBeGreaterThanOrEqual(previous);
      previous = metres;
    }
  });
});

describe('Race-Specific (PRD §7.7)', () => {
  it('runs 2 stations then 1km, 4 rounds, at race pace', () => {
    expect(compromisedRunFor(ctx('RACE_SPECIFIC', 1, 3))).toMatchObject({
      stationsPerRound: 2,
      runDistanceM: 1000,
      rounds: 4,
      zone: 'THRESHOLD',
    });
  });

  it('moves to full race-order sequences after the first week', () => {
    expect(compromisedRunFor(ctx('RACE_SPECIFIC', 1, 3))?.raceOrderSequence).toBe(false);
    expect(compromisedRunFor(ctx('RACE_SPECIFIC', 2, 3))?.raceOrderSequence).toBe(true);
  });

  it('is more demanding than any Build week', () => {
    const raceSpec = compromisedRunFor(ctx('RACE_SPECIFIC', 1, 3));
    const lastBuild = compromisedRunFor(ctx('BUILD', 4, 4));
    if (raceSpec === null || lastBuild === null) throw new Error('expected prescriptions');
    expect(raceSpec.stationsPerRound).toBeGreaterThan(lastBuild.stationsPerRound);
    expect(compromisedRunningMetres(raceSpec)).toBeGreaterThan(
      compromisedRunningMetres(lastBuild),
    );
  });
});

describe('Taper (PRD §7.7)', () => {
  it('is one short session at race pace', () => {
    const taper = compromisedRunFor(ctx('TAPER', 1, 1));
    expect(taper).toMatchObject({ rounds: 2, runDistanceM: 1000, zone: 'THRESHOLD' });
  });

  it('cuts volume by 40-50% against Race-Specific, per §7.2', () => {
    const taper = compromisedRunFor(ctx('TAPER', 1, 1));
    const raceSpec = compromisedRunFor(ctx('RACE_SPECIFIC', 2, 3));
    if (taper === null || raceSpec === null) throw new Error('expected prescriptions');

    const remaining = compromisedRunningMetres(taper) / compromisedRunningMetres(raceSpec);
    // §7.2 Taper: "volume cut 40-50%", so 50-60% of the load remains.
    expect(remaining).toBeGreaterThanOrEqual(0.5);
    expect(remaining).toBeLessThanOrEqual(0.6);
  });
});

describe('general properties', () => {
  it('is deterministic', () => {
    for (const phase of PHASE_TYPES) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        for (let week = 1; week <= 4; week += 1) {
          expect(compromisedRunFor(ctx(phase, week, 4, background))).toEqual(
            compromisedRunFor(ctx(phase, week, 4, background)),
          );
        }
      }
    }
  });

  it('always prescribes at least one station and one round when prescribed at all', () => {
    for (const phase of PHASE_TYPES) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        for (let week = 1; week <= 4; week += 1) {
          const prescription = compromisedRunFor(ctx(phase, week, 4, background));
          if (prescription === null) continue;
          expect(prescription.stationsPerRound).toBeGreaterThanOrEqual(1);
          expect(prescription.rounds).toBeGreaterThanOrEqual(1);
          expect(prescription.runDistanceM).toBeGreaterThan(0);
        }
      }
    }
  });

  it('reports running metres for the weekly budget (ERRATA R2)', () => {
    // Every planned metre counts toward the volume ceiling, including these.
    expect(compromisedRunningMetres({
      stationsPerRound: 1,
      runDistanceM: 800,
      rounds: 4,
      zone: 'THRESHOLD',
      raceOrderSequence: false,
    })).toBe(3200);
  });

  it('rejects invalid week numbers', () => {
    expect(() => compromisedRunFor(ctx('BUILD', 0, 4))).toThrow(RangeError);
    expect(() => compromisedRunFor(ctx('BUILD', 1, 0))).toThrow(RangeError);
    expect(() => compromisedRunFor(ctx('BUILD', 1.5, 4))).toThrow(RangeError);
  });
});
