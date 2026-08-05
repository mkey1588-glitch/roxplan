import { describe, expect, it } from 'vitest';

import enMessages from '@/messages/en.json';

import { DAYS_PER_WEEK } from './calendar';
import {
  compositionFor,
  InvalidSessionsPerWeekError,
  MAX_SESSIONS_PER_WEEK,
  MIN_REST_DAYS_PER_WEEK,
  MIN_SESSIONS_PER_WEEK,
  scheduleWeek,
  templateFor,
} from './templates';
import type { SlotKind, WeeklyComposition } from './templates';
import { ATHLETIC_BACKGROUNDS, PHASE_TYPES } from './types';

const SESSION_COUNTS = [2, 3, 4, 5, 6];

const trainingDays = (composition: WeeklyComposition): number =>
  composition.run + composition.strength + composition.hybrid;

/** Every (days x phase x background) combination the engine can be asked for. */
function everyCombination(): {
  sessionsPerWeek: number;
  phase: (typeof PHASE_TYPES)[number];
  background: (typeof ATHLETIC_BACKGROUNDS)[number];
}[] {
  const combos = [];
  for (const sessionsPerWeek of SESSION_COUNTS) {
    for (const phase of PHASE_TYPES) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        combos.push({ sessionsPerWeek, phase, background });
      }
    }
  }
  return combos;
}

describe('composition invariants across every combination', () => {
  it('schedules exactly the sessions the athlete said they have', () => {
    for (const { sessionsPerWeek, phase, background } of everyCombination()) {
      const composition = compositionFor(sessionsPerWeek, phase, background);
      expect(trainingDays(composition)).toBe(sessionsPerWeek);
    }
  });

  it('always leaves at least one full rest day (guardrail 4)', () => {
    for (const { sessionsPerWeek, phase, background } of everyCombination()) {
      const composition = compositionFor(sessionsPerWeek, phase, background);
      expect(composition.rest).toBeGreaterThanOrEqual(MIN_REST_DAYS_PER_WEEK);
    }
  });

  it('accounts for all seven days', () => {
    for (const { sessionsPerWeek, phase, background } of everyCombination()) {
      const composition = compositionFor(sessionsPerWeek, phase, background);
      expect(trainingDays(composition) + composition.rest).toBe(DAYS_PER_WEEK);
    }
  });

  it('never prescribes a negative count', () => {
    for (const { sessionsPerWeek, phase, background } of everyCombination()) {
      const composition = compositionFor(sessionsPerWeek, phase, background);
      for (const count of [composition.run, composition.strength, composition.hybrid]) {
        expect(count).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('always includes at least one run and one hybrid', () => {
    // Running is over half the race, and the hybrid slot is the only place
    // station work happens. A week without either is not a HYROX week.
    for (const { sessionsPerWeek, phase, background } of everyCombination()) {
      const composition = compositionFor(sessionsPerWeek, phase, background);
      expect(composition.run).toBeGreaterThanOrEqual(1);
      expect(composition.hybrid).toBeGreaterThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    for (const { sessionsPerWeek, phase, background } of everyCombination()) {
      expect(compositionFor(sessionsPerWeek, phase, background)).toEqual(
        compositionFor(sessionsPerWeek, phase, background),
      );
    }
  });
});

describe('base templates (PRD §7.4)', () => {
  it.each([
    [2, { run: 1, strength: 0, hybrid: 1, rest: 5 }],
    [3, { run: 2, strength: 0, hybrid: 1, rest: 4 }],
    [4, { run: 2, strength: 1, hybrid: 1, rest: 3 }],
    [5, { run: 2, strength: 2, hybrid: 1, rest: 2 }],
    [6, { run: 3, strength: 2, hybrid: 1, rest: 1 }],
  ])('%i days a week, HYBRID background, Foundation', (sessionsPerWeek, expected) => {
    expect(compositionFor(sessionsPerWeek, 'FOUNDATION', 'HYBRID')).toEqual(expected);
  });

  it('supports the 2-day week rather than turning the athlete away (D6)', () => {
    const template = templateFor(2, 'FOUNDATION', 'HYBRID');
    expect(template.composition).toEqual({ run: 1, strength: 0, hybrid: 1, rest: 5 });
    expect(template.noteKeys).toContain('plan.note.twoDayWeek');
  });

  it('has a real message behind every note key it emits (D5)', () => {
    // The engine emits keys, not prose. A key with no message is a blank
    // space in the UI, which no type checker would have caught.
    for (const { sessionsPerWeek, phase, background } of everyCombination()) {
      for (const key of templateFor(sessionsPerWeek, phase, background).noteKeys) {
        const message = key
          .split('.')
          .reduce<unknown>(
            (node, segment) =>
              typeof node === 'object' && node !== null
                ? (node as Record<string, unknown>)[segment]
                : undefined,
            enMessages,
          );
        expect(typeof message).toBe('string');
        expect(message).not.toBe('');
      }
    }
  });

  it('only notes the 2-day case', () => {
    for (const sessionsPerWeek of [3, 4, 5, 6]) {
      expect(templateFor(sessionsPerWeek, 'FOUNDATION', 'HYBRID').noteKeys).toEqual([]);
    }
  });
});

describe('running frequency (ERRATA F36 / R8)', () => {
  it('gives every athlete training 3+ days at least two runs a week', () => {
    // Running is more than half the race. One run a week is not a HYROX plan,
    // and in Foundation the hybrid carries no running at all, so a 3-day
    // athlete previously ran once a fortnight's worth of sessions.
    for (const sessionsPerWeek of [3, 4, 5, 6]) {
      for (const phase of PHASE_TYPES) {
        for (const background of ATHLETIC_BACKGROUNDS) {
          expect(
            compositionFor(sessionsPerWeek, phase, background).run,
            `${sessionsPerWeek}d/${phase}/${background}`,
          ).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('leaves the 2-day week at one run, where there is no room for more', () => {
    expect(compositionFor(2, 'FOUNDATION', 'HYBRID').run).toBe(1);
  });
});

describe('the 6-day template (ERRATA F08)', () => {
  it('is six sessions plus a rest day, not seven sessions', () => {
    // The PRD's "3 run, 2 strength, 1 hybrid + 1 recovery" is seven sessions
    // in a seven-day week, which breaches guardrail 4 by construction.
    const composition = compositionFor(6, 'FOUNDATION', 'HYBRID');
    expect(trainingDays(composition)).toBe(6);
    expect(composition.rest).toBe(1);
  });

  it('keeps its rest day under every background and phase', () => {
    for (const phase of PHASE_TYPES) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        expect(compositionFor(6, phase, background).rest).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('places the rest day mid-week rather than at the end', () => {
    // Six training days bunched into positions 0-5 would give five
    // consecutive sessions before any recovery.
    const slots = scheduleWeek(compositionFor(6, 'FOUNDATION', 'HYBRID'));
    expect(slots.indexOf('REST')).toBe(3);
  });
});

describe('RUNNER modifier (PRD §7.3, ERRATA F09)', () => {
  it('substitutes a run for a strength session rather than adding one', () => {
    const hybrid = compositionFor(6, 'FOUNDATION', 'HYBRID');
    const runner = compositionFor(6, 'FOUNDATION', 'RUNNER');

    expect(trainingDays(runner)).toBe(trainingDays(hybrid));
    expect(runner.strength).toBe(hybrid.strength + 1);
    expect(runner.run).toBe(hybrid.run - 1);
  });

  it('never exceeds the athlete’s stated availability', () => {
    // The additive reading gave a 6-day RUNNER seven sessions and no rest day.
    for (const sessionsPerWeek of SESSION_COUNTS) {
      for (const phase of PHASE_TYPES) {
        const composition = compositionFor(sessionsPerWeek, phase, 'RUNNER');
        expect(trainingDays(composition)).toBe(sessionsPerWeek);
        expect(composition.rest).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('applies in Foundation only', () => {
    for (const phase of PHASE_TYPES) {
      const runner = compositionFor(6, phase, 'RUNNER');
      const hybrid = compositionFor(6, phase, 'HYBRID');
      if (phase === 'FOUNDATION') {
        expect(runner).not.toEqual(hybrid);
      } else {
        expect(runner).toEqual(hybrid);
      }
    }
  });

  it('leaves at least two runs, so a runner never trains on one run a week', () => {
    // Trading down to a single run for someone whose background is running
    // also forces the week's entire volume into one session.
    for (const sessionsPerWeek of [2, 3, 4, 5, 6]) {
      const hybrid = compositionFor(sessionsPerWeek, 'FOUNDATION', 'HYBRID');
      const runner = compositionFor(sessionsPerWeek, 'FOUNDATION', 'RUNNER');
      expect(runner.run).toBeGreaterThanOrEqual(Math.min(2, hybrid.run));
    }
  });

  it('is a no-op below 3 runs a week, where there is nothing safe to trade', () => {
    for (const sessionsPerWeek of [2, 3, 4, 5]) {
      expect(compositionFor(sessionsPerWeek, 'FOUNDATION', 'RUNNER')).toEqual(
        compositionFor(sessionsPerWeek, 'FOUNDATION', 'HYBRID'),
      );
    }
  });

  it('always leaves the athlete at least one run', () => {
    for (const sessionsPerWeek of SESSION_COUNTS) {
      expect(compositionFor(sessionsPerWeek, 'FOUNDATION', 'RUNNER').run).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('STRENGTH modifier (PRD §7.3)', () => {
  it('never exceeds two lifting sessions a week', () => {
    for (const sessionsPerWeek of SESSION_COUNTS) {
      for (const phase of PHASE_TYPES) {
        expect(compositionFor(sessionsPerWeek, phase, 'STRENGTH').strength).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('Race-Specific 5-day swap (PRD §7.4)', () => {
  it('replaces a strength day with a hybrid', () => {
    const build = compositionFor(5, 'BUILD', 'HYBRID');
    const raceSpecific = compositionFor(5, 'RACE_SPECIFIC', 'HYBRID');

    expect(raceSpecific.strength).toBe(build.strength - 1);
    expect(raceSpecific.hybrid).toBe(build.hybrid + 1);
    expect(trainingDays(raceSpecific)).toBe(5);
  });

  it('leaves other session counts alone', () => {
    for (const sessionsPerWeek of [2, 3, 4, 6]) {
      expect(compositionFor(sessionsPerWeek, 'RACE_SPECIFIC', 'HYBRID')).toEqual(
        compositionFor(sessionsPerWeek, 'BUILD', 'HYBRID'),
      );
    }
  });
});

describe('scheduleWeek', () => {
  it('returns exactly seven day positions', () => {
    for (const { sessionsPerWeek, phase, background } of everyCombination()) {
      const slots = scheduleWeek(compositionFor(sessionsPerWeek, phase, background));
      expect(slots).toHaveLength(DAYS_PER_WEEK);
    }
  });

  it('places exactly the composition it was given', () => {
    for (const { sessionsPerWeek, phase, background } of everyCombination()) {
      const composition = compositionFor(sessionsPerWeek, phase, background);
      const slots = scheduleWeek(composition);
      const count = (kind: SlotKind): number => slots.filter((slot) => slot === kind).length;

      expect(count('RUN')).toBe(composition.run);
      expect(count('STRENGTH')).toBe(composition.strength);
      expect(count('HYBRID')).toBe(composition.hybrid);
      expect(count('REST')).toBe(composition.rest);
    }
  });

  it('never repeats a kind on consecutive days when an alternative exists', () => {
    for (const { sessionsPerWeek, phase, background } of everyCombination()) {
      const composition = compositionFor(sessionsPerWeek, phase, background);
      const slots = scheduleWeek(composition);
      const distinctKinds = [composition.run, composition.strength, composition.hybrid].filter(
        (count) => count > 0,
      ).length;
      if (distinctKinds < 2) continue;

      for (let day = 1; day < slots.length; day += 1) {
        const previous = slots[day - 1];
        const current = slots[day];
        if (previous === 'REST' || current === 'REST') continue;
        expect(current).not.toBe(previous);
      }
    }
  });

  it('spreads sessions rather than bunching them', () => {
    // The longest run of consecutive training days must stay below the number
    // of sessions whenever a rest day could break it up.
    for (const { sessionsPerWeek, phase, background } of everyCombination()) {
      if (sessionsPerWeek >= 6) continue;
      const slots = scheduleWeek(compositionFor(sessionsPerWeek, phase, background));

      let longest = 0;
      let current = 0;
      for (const slot of slots) {
        current = slot === 'REST' ? 0 : current + 1;
        longest = Math.max(longest, current);
      }
      expect(longest).toBeLessThan(sessionsPerWeek);
    }
  });

  it('is deterministic', () => {
    for (const { sessionsPerWeek, phase, background } of everyCombination()) {
      const composition = compositionFor(sessionsPerWeek, phase, background);
      expect(scheduleWeek(composition)).toEqual(scheduleWeek(composition));
    }
  });

  it('returns frozen slots, so a template cannot be mutated in place', () => {
    expect(Object.isFrozen(scheduleWeek(compositionFor(4, 'BUILD', 'HYBRID')))).toBe(true);
  });
});

describe('input validation', () => {
  it.each([0, 1, 7, 8, -1, 3.5, Number.NaN])('rejects %s sessions a week', (sessionsPerWeek) => {
    expect(() => compositionFor(sessionsPerWeek, 'FOUNDATION', 'HYBRID')).toThrow(
      InvalidSessionsPerWeekError,
    );
  });

  it('accepts the documented bounds', () => {
    expect(() => compositionFor(MIN_SESSIONS_PER_WEEK, 'FOUNDATION', 'HYBRID')).not.toThrow();
    expect(() => compositionFor(MAX_SESSIONS_PER_WEEK, 'FOUNDATION', 'HYBRID')).not.toThrow();
  });
});
