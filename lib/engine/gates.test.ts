import { describe, expect, it } from 'vitest';

import {
  advanceWeeks,
  applyCompletion,
  assertValidGate,
  BEGINNER_INTERVAL_UNLOCK_MINUTES,
  compromisedRunThreshold,
  DEFAULT_COMPROMISED_RUN_THRESHOLD,
  InvalidGateError,
  isSatisfied,
  MIN_COMPROMISED_RUN_THRESHOLD,
  resolveSession,
  seedGateProgress,
} from './gates';
import type { Gate, GateProgress, GatedSession } from './gates';

const intervalGate: Gate = {
  condition: { type: 'CONTINUOUS_RUN_MINUTES', value: BEGINNER_INTERVAL_UNLOCK_MINUTES },
  fallbackType: 'EASY_RUN',
};

const simulationGate: Gate = {
  condition: { type: 'COMPROMISED_RUNS_COMPLETED', value: 3 },
  fallbackType: 'COMPROMISED_RUN',
};

const zeroProgress: GateProgress = {
  longestContinuousRunSecs: 0,
  compromisedRunsCompleted: 0,
  weeksElapsed: 0,
};

describe('seeding from the baseline (ERRATA F14)', () => {
  it('does not gate an athlete who already runs the required duration', () => {
    // A beginner who reported 35 minutes at onboarding must not be locked out
    // of intervals in week 1 purely for lack of a log entry.
    const progress = seedGateProgress(35);
    expect(isSatisfied(intervalGate.condition, progress)).toBe(true);
  });

  it('still gates an athlete below the threshold', () => {
    expect(isSatisfied(intervalGate.condition, seedGateProgress(20))).toBe(false);
  });

  it('treats the threshold as inclusive', () => {
    expect(isSatisfied(intervalGate.condition, seedGateProgress(30))).toBe(true);
  });

  it('accepts an athlete who does not run at all', () => {
    expect(seedGateProgress(0).longestContinuousRunSecs).toBe(0);
  });

  it('rejects nonsense input', () => {
    expect(() => seedGateProgress(-1)).toThrow(RangeError);
    expect(() => seedGateProgress(Number.NaN)).toThrow(RangeError);
  });
});

describe('latching (ERRATA F14)', () => {
  it('never re-locks once satisfied, because progress is monotonic', () => {
    let progress = seedGateProgress(0);
    progress = applyCompletion(progress, 'LONG_RUN', 32 * 60);
    expect(isSatisfied(intervalGate.condition, progress)).toBe(true);

    // A later, shorter run must not undo the unlock.
    progress = applyCompletion(progress, 'EASY_RUN', 10 * 60);
    expect(isSatisfied(intervalGate.condition, progress)).toBe(true);
    expect(progress.longestContinuousRunSecs).toBe(32 * 60);
  });

  it('keeps the longest run ever, not the most recent', () => {
    let progress = seedGateProgress(0);
    for (const secs of [600, 1800, 900, 300]) {
      progress = applyCompletion(progress, 'EASY_RUN', secs);
    }
    expect(progress.longestContinuousRunSecs).toBe(1800);
  });

  it('counts continuous running, not session duration', () => {
    // A run/walk beginner's session is longer than their unbroken running,
    // which is the distinction the PRD's logging model lacked.
    const progress = applyCompletion(seedGateProgress(0), 'EASY_RUN', 12 * 60);
    expect(progress.longestContinuousRunSecs).toBe(12 * 60);
    expect(isSatisfied(intervalGate.condition, progress)).toBe(false);
  });
});

describe('compromised-run threshold (ERRATA F15)', () => {
  it('uses the full threshold when the plan can deliver it', () => {
    expect(compromisedRunThreshold(5)).toBe(DEFAULT_COMPROMISED_RUN_THRESHOLD);
    expect(compromisedRunThreshold(3)).toBe(DEFAULT_COMPROMISED_RUN_THRESHOLD);
  });

  it('scales down so short plans can still reach a simulation', () => {
    // A 6-week plan schedules two compromised runs before Race-Specific. A
    // flat threshold of 3 would mean the athlete never rehearses the race.
    expect(compromisedRunThreshold(2)).toBe(2);
    expect(compromisedRunThreshold(1)).toBe(1);
  });

  it('never drops to zero, however short the plan', () => {
    // A simulation with no rehearsal at all is what the gate exists to stop.
    expect(compromisedRunThreshold(0)).toBe(MIN_COMPROMISED_RUN_THRESHOLD);
    expect(compromisedRunThreshold(0)).toBeGreaterThan(0);
  });

  it('never exceeds the default', () => {
    for (let scheduled = 0; scheduled <= 20; scheduled += 1) {
      expect(compromisedRunThreshold(scheduled)).toBeLessThanOrEqual(
        DEFAULT_COMPROMISED_RUN_THRESHOLD,
      );
    }
  });

  it('rejects nonsense input', () => {
    expect(() => compromisedRunThreshold(-1)).toThrow(RangeError);
    expect(() => compromisedRunThreshold(1.5)).toThrow(RangeError);
  });
});

describe('fallback completions count toward the gate (ERRATA F15)', () => {
  it('counts a compromised run served as a simulation fallback', () => {
    const session: GatedSession = { plannedType: 'RACE_SIMULATION', gate: simulationGate };

    let progress = zeroProgress;
    expect(resolveSession(session, progress).type).toBe('COMPROMISED_RUN');

    // Complete the fallback three times — genuine transition practice.
    for (let i = 0; i < 3; i += 1) {
      const served = resolveSession(session, progress);
      progress = applyCompletion(progress, served.type);
    }

    expect(progress.compromisedRunsCompleted).toBe(3);
    expect(resolveSession(session, progress).type).toBe('RACE_SIMULATION');
  });

  it('cannot self-unlock, because progress is read before the session is served', () => {
    const session: GatedSession = {
      plannedType: 'RACE_SIMULATION',
      gate: { condition: { type: 'COMPROMISED_RUNS_COMPLETED', value: 1 }, fallbackType: 'COMPROMISED_RUN' },
    };

    const served = resolveSession(session, zeroProgress);
    expect(served.type).toBe('COMPROMISED_RUN');
    expect(served.locked).toBe(true);

    // The increment lands after the day is done, so it only affects later
    // sessions — the athlete never gets a simulation they had not prepared for.
    const after = applyCompletion(zeroProgress, served.type);
    expect(after.compromisedRunsCompleted).toBe(1);
  });

  it('only counts compromised runs', () => {
    let progress = zeroProgress;
    for (const type of ['EASY_RUN', 'STRENGTH_LOWER', 'STATION_SKILL', 'REST'] as const) {
      progress = applyCompletion(progress, type);
    }
    expect(progress.compromisedRunsCompleted).toBe(0);
  });
});

describe('resolveSession', () => {
  it('serves the planned session when ungated', () => {
    const resolved = resolveSession({ plannedType: 'INTERVAL_RUN', gate: null }, zeroProgress);
    expect(resolved).toEqual({ type: 'INTERVAL_RUN', locked: false, pendingCondition: null });
  });

  it('serves the fallback while locked, and says what is pending', () => {
    const resolved = resolveSession({ plannedType: 'INTERVAL_RUN', gate: intervalGate }, zeroProgress);
    expect(resolved.type).toBe('EASY_RUN');
    expect(resolved.locked).toBe(true);
    expect(resolved.pendingCondition).toEqual(intervalGate.condition);
  });

  it('serves the planned session once unlocked', () => {
    const resolved = resolveSession(
      { plannedType: 'INTERVAL_RUN', gate: intervalGate },
      seedGateProgress(30),
    );
    expect(resolved.type).toBe('INTERVAL_RUN');
    expect(resolved.locked).toBe(false);
    expect(resolved.pendingCondition).toBeNull();
  });

  it('is deterministic for the same inputs', () => {
    const session: GatedSession = { plannedType: 'INTERVAL_RUN', gate: intervalGate };
    expect(resolveSession(session, zeroProgress)).toEqual(resolveSession(session, zeroProgress));
  });
});

describe('guardrail 6 — a gate always carries a valid fallback', () => {
  it('rejects a fallback identical to the gated session', () => {
    expect(() =>
      assertValidGate({ condition: intervalGate.condition, fallbackType: 'INTERVAL_RUN' }, 'INTERVAL_RUN'),
    ).toThrow(InvalidGateError);
  });

  it('rejects falling back to REST', () => {
    // A locked session should still train something.
    expect(() =>
      assertValidGate({ condition: intervalGate.condition, fallbackType: 'REST' }, 'INTERVAL_RUN'),
    ).toThrow(InvalidGateError);
  });

  it('rejects a non-positive threshold', () => {
    expect(() =>
      assertValidGate(
        { condition: { type: 'WEEKS_ELAPSED', value: 0 }, fallbackType: 'EASY_RUN' },
        'INTERVAL_RUN',
      ),
    ).toThrow(InvalidGateError);
  });

  it('accepts a well-formed gate', () => {
    expect(() => assertValidGate(intervalGate, 'INTERVAL_RUN')).not.toThrow();
    expect(() => assertValidGate(simulationGate, 'RACE_SIMULATION')).not.toThrow();
  });

  it('validates on every resolution, so a bad gate cannot be served', () => {
    expect(() =>
      resolveSession(
        { plannedType: 'INTERVAL_RUN', gate: { condition: intervalGate.condition, fallbackType: 'REST' } },
        zeroProgress,
      ),
    ).toThrow(InvalidGateError);
  });
});

describe('elapsed weeks', () => {
  it('accumulates', () => {
    expect(advanceWeeks(advanceWeeks(zeroProgress, 2), 3).weeksElapsed).toBe(5);
  });

  it('satisfies a WEEKS_ELAPSED condition once reached', () => {
    const condition = { type: 'WEEKS_ELAPSED', value: 4 } as const;
    expect(isSatisfied(condition, advanceWeeks(zeroProgress, 3))).toBe(false);
    expect(isSatisfied(condition, advanceWeeks(zeroProgress, 4))).toBe(true);
  });

  it('rejects negative or fractional weeks', () => {
    expect(() => advanceWeeks(zeroProgress, -1)).toThrow(RangeError);
    expect(() => advanceWeeks(zeroProgress, 1.5)).toThrow(RangeError);
  });
});
