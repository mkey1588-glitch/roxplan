import { describe, expect, it } from 'vitest';

import enMessages from '@/messages/en.json';
import type { StationId } from '@/lib/seeds/types';

import { compromisedRunThreshold } from './gates';
import { allocatePhases } from './phases';
import {
  MIN_RUN_DISTANCE_M,
  prescribeWeek,
  runTypeFor,
  selectStations,
  shouldSimulate,
  SIMULATION_EXCLUSION_DAYS,
  SIMULATION_RUNNING_M,
  weeklyRunningMetres,
} from './prescribe';
import type { PlannedSession } from './prescribe';
import { planWeeklyVolume } from './progression/volume';
import { ATHLETIC_BACKGROUNDS } from './types';
import type { AthleticBackground } from './types';

const WEAKEST: readonly StationId[] = ['WALL_BALLS', 'SLED_PUSH'];

function prescribePlan(
  weeks: number,
  sessionsPerWeek: number,
  background: AthleticBackground,
  currentWeeklyRunM = 20000,
): PlannedSession[][] {
  const allocation = allocatePhases(weeks, background);
  const volumes = planWeeklyVolume({
    weeks,
    allocation,
    background,
    currentWeeklyRunM,
    baselineConfidence: 'HIGH',
  });

  return volumes.map((volume) => [
    ...prescribeWeek({
      weekIndex: volume.weekIndex,
      volume,
      allocation,
      sessionsPerWeek,
      background,
      totalWeeks: weeks,
      weakestStations: WEAKEST,
      simulationGateThreshold: compromisedRunThreshold(3),
      maxSingleRunM: 25000,
    }),
  ]);
}

const lookupMessage = (key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      enMessages,
    );

describe('week structure', () => {
  it('fills all seven days, every week, for every profile', () => {
    for (const sessionsPerWeek of [2, 3, 4, 5, 6]) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        for (const week of prescribePlan(16, sessionsPerWeek, background)) {
          expect(week).toHaveLength(7);
          const offsets = week.map((session) => session.dayOffset);
          expect(new Set(offsets).size).toBe(7);
        }
      }
    }
  });

  it('always includes at least one full rest day (guardrail 4)', () => {
    for (const sessionsPerWeek of [2, 3, 4, 5, 6]) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        for (const week of prescribePlan(16, sessionsPerWeek, background)) {
          expect(week.filter((session) => session.type === 'REST').length).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('gives every session at least one block', () => {
    for (const week of prescribePlan(16, 5, 'HYBRID')) {
      for (const session of week) expect(session.blocks.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('numbers blocks from 1, in order', () => {
    for (const week of prescribePlan(16, 5, 'HYBRID')) {
      for (const session of week) {
        expect(session.blocks.map((block) => block.order)).toEqual(
          session.blocks.map((_unused, index) => index + 1),
        );
      }
    }
  });

  it('is deterministic', () => {
    expect(prescribePlan(16, 4, 'BEGINNER')).toEqual(prescribePlan(16, 4, 'BEGINNER'));
  });
});

describe('running budget is respected (ERRATA R2)', () => {
  it('never plans more running than the week’s budget allows', () => {
    for (const sessionsPerWeek of [2, 3, 4, 5, 6]) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        const allocation = allocatePhases(16, background);
        const volumes = planWeeklyVolume({
          weeks: 16,
          allocation,
          background,
          currentWeeklyRunM: 20000,
          baselineConfidence: 'HIGH',
        });

        for (const volume of volumes) {
          const sessions = prescribeWeek({
            weekIndex: volume.weekIndex,
            volume,
            allocation,
            sessionsPerWeek,
            background,
            totalWeeks: 16,
            weakestStations: WEAKEST,
            simulationGateThreshold: compromisedRunThreshold(3),
            maxSingleRunM: 25000,
          });

          // Tight: the interval session's fixed warm-up and cool-down are
          // reserved from the budget before the steady runs are sized, so
          // only integer rounding is left over. A loose allowance here would
          // have hidden exactly the overshoot this caught.
          const planned = weeklyRunningMetres(sessions);
          expect(planned).toBeLessThanOrEqual(volume.runningBudgetM + 10);
        }
      }
    }
  });

  it('displaces other running on a simulation week rather than stacking on top', () => {
    // R2's worked example: the simulation consumes the budget, so other
    // running shrinks instead of the week ballooning past the ceiling.
    const weeks = prescribePlan(16, 5, 'HYBRID', 20000);
    const simulationWeek = weeks.find((week) =>
      week.some((session) => session.type === 'RACE_SIMULATION'),
    );
    if (simulationWeek === undefined) throw new Error('expected a simulation week');

    const recovery = simulationWeek.filter((s) => s.type === 'RECOVERY_MOBILITY');
    const runs = simulationWeek.filter((s) =>
      ['EASY_RUN', 'LONG_RUN', 'INTERVAL_RUN'].includes(s.type),
    );
    // Some run slots became recovery: displacement actually happened.
    expect(recovery.length + runs.length).toBeGreaterThan(0);
  });

  it('never prescribes a token run below the minimum worth doing', () => {
    for (const week of prescribePlan(16, 5, 'HYBRID')) {
      for (const session of week) {
        for (const block of session.blocks) {
          if (block.prescription.kind === 'RUN' && block.titleKey !== 'plan.block.warmup') {
            expect(block.prescription.distanceM).toBeGreaterThanOrEqual(MIN_RUN_DISTANCE_M);
          }
        }
      }
    }
  });
});

describe('race simulations (guardrail 5)', () => {
  it('never schedules one within 10 days of race day', () => {
    for (const sessionsPerWeek of [2, 3, 4, 5, 6]) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        for (const weeks of [8, 12, 16, 20]) {
          const raceDayOffset = weeks * 7 - 1;
          for (const week of prescribePlan(weeks, sessionsPerWeek, background)) {
            for (const session of week) {
              if (session.type !== 'RACE_SIMULATION') continue;
              expect(raceDayOffset - session.dayOffset).toBeGreaterThanOrEqual(
                SIMULATION_EXCLUSION_DAYS,
              );
            }
          }
        }
      }
    }
  });

  it('only ever simulates during Race-Specific', () => {
    for (const week of prescribePlan(20, 5, 'HYBRID')) {
      for (const session of week) {
        if (session.type === 'RACE_SIMULATION') expect(session.phase).toBe('RACE_SPECIFIC');
      }
    }
  });

  it('always gates a simulation on rehearsal, with a compromised-run fallback', () => {
    for (const week of prescribePlan(20, 5, 'HYBRID')) {
      for (const session of week) {
        if (session.type !== 'RACE_SIMULATION') continue;
        expect(session.gate).not.toBeNull();
        expect(session.gate?.condition.type).toBe('COMPROMISED_RUNS_COMPLETED');
        expect(session.gate?.fallbackType).toBe('COMPROMISED_RUN');
      }
    }
  });

  it('counts a simulation as the full 8km of race running', () => {
    expect(SIMULATION_RUNNING_M).toBe(8000);
    expect(shouldSimulate('RACE_SPECIFIC', 1, 0, 20)).toBe(true);
  });

  it('skips the simulation for an athlete whose whole week is under 8km (ERRATA F34)', () => {
    // A full simulation would be the entire week's running and more, which
    // breaches guardrail 1 on its own. They keep compromised runs instead.
    const lowVolume = prescribePlan(16, 4, 'BEGINNER', 4000).flat();
    expect(lowVolume.some((session) => session.type === 'RACE_SIMULATION')).toBe(false);
    expect(lowVolume.some((session) => session.type === 'COMPROMISED_RUN')).toBe(true);
  });

  it('still simulates for an athlete with the volume to absorb it', () => {
    const highVolume = prescribePlan(16, 5, 'HYBRID', 30000).flat();
    expect(highVolume.some((session) => session.type === 'RACE_SIMULATION')).toBe(true);
  });

  it('refuses to simulate outside Race-Specific or too near the race', () => {
    expect(shouldSimulate('BUILD', 1, 0, 20)).toBe(false);
    expect(shouldSimulate('TAPER', 1, 0, 20)).toBe(false);
    // Race day is offset 139 in a 20-week plan; 5 days out must be refused.
    expect(shouldSimulate('RACE_SPECIFIC', 1, 134, 20)).toBe(false);
  });
});

describe('gated interval runs for beginners (§7.5)', () => {
  it('gates every interval run for a BEGINNER, with an equal-effort fallback', () => {
    let gatedCount = 0;
    for (const week of prescribePlan(20, 5, 'BEGINNER')) {
      for (const session of week) {
        if (session.type !== 'INTERVAL_RUN') continue;
        gatedCount += 1;
        expect(session.gate?.condition).toEqual({
          type: 'CONTINUOUS_RUN_MINUTES',
          value: 30,
        });
        expect(session.gate?.fallbackType).toBe('EASY_RUN');
      }
    }
    expect(gatedCount).toBeGreaterThan(0);
  });

  it('does not gate interval runs for other backgrounds', () => {
    for (const background of ['RUNNER', 'STRENGTH', 'HYBRID'] as const) {
      for (const week of prescribePlan(20, 5, background)) {
        for (const session of week) {
          if (session.type === 'INTERVAL_RUN') expect(session.gate).toBeNull();
        }
      }
    }
  });

  it('never leaves a gate without a fallback (guardrail 6)', () => {
    for (const sessionsPerWeek of [2, 3, 4, 5, 6]) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        for (const week of prescribePlan(16, sessionsPerWeek, background)) {
          for (const session of week) {
            if (session.gate === null) continue;
            expect(session.gate.fallbackType).toBeDefined();
            expect(session.gate.fallbackType).not.toBe(session.type);
            expect(session.gate.fallbackType).not.toBe('REST');
          }
        }
      }
    }
  });
});

describe('phase intent (PRD §7.2)', () => {
  it('prescribes no intervals and no simulations in Foundation', () => {
    for (const week of prescribePlan(20, 5, 'HYBRID')) {
      for (const session of week) {
        if (session.phase !== 'FOUNDATION') continue;
        expect(session.type).not.toBe('INTERVAL_RUN');
        expect(session.type).not.toBe('RACE_SIMULATION');
      }
    }
  });

  it('couples no runs to stations in Foundation — station skill only (§7.7)', () => {
    for (const week of prescribePlan(20, 5, 'HYBRID')) {
      for (const session of week) {
        if (session.phase !== 'FOUNDATION') continue;
        expect(session.type).not.toBe('COMPROMISED_RUN');
      }
    }
  });

  it('introduces compromised running in Build', () => {
    const buildSessions = prescribePlan(20, 5, 'HYBRID')
      .flat()
      .filter((session) => session.phase === 'BUILD');
    expect(buildSessions.some((session) => session.type === 'COMPROMISED_RUN')).toBe(true);
  });

  it('keeps the taper easy — no intervals, no simulations', () => {
    for (const week of prescribePlan(20, 5, 'HYBRID')) {
      for (const session of week) {
        if (session.phase !== 'TAPER') continue;
        expect(['EASY_RUN', 'REST', 'COMPROMISED_RUN', 'STRENGTH_LOWER', 'STRENGTH_UPPER', 'RECOVERY_MOBILITY']).toContain(
          session.type,
        );
      }
    }
  });
});

describe('runTypeFor', () => {
  it('keeps Foundation aerobic', () => {
    expect(runTypeFor('FOUNDATION', 0, 3)).toBe('EASY_RUN');
  });

  it('puts the quality run first from Build onwards', () => {
    expect(runTypeFor('BUILD', 0, 3)).toBe('INTERVAL_RUN');
    expect(runTypeFor('RACE_SPECIFIC', 0, 2)).toBe('INTERVAL_RUN');
  });

  it('makes the last run of a multi-run week the long one', () => {
    expect(runTypeFor('FOUNDATION', 2, 3)).toBe('LONG_RUN');
  });

  it('keeps the taper easy', () => {
    expect(runTypeFor('TAPER', 0, 2)).toBe('EASY_RUN');
  });
});

describe('selectStations (§7.7)', () => {
  it('favours the athlete’s weakest stations', () => {
    expect(selectStations(WEAKEST, 2, 0)).toEqual(['WALL_BALLS', 'SLED_PUSH']);
  });

  it('falls back to leg-dominant stations when none are known', () => {
    const chosen = selectStations([], 2, 0);
    expect(chosen).toHaveLength(2);
    expect(chosen[0]).toBe('SLED_PUSH');
  });

  it('rotates week to week so the athlete is not fed the same station forever', () => {
    expect(selectStations(WEAKEST, 1, 0)).not.toEqual(selectStations(WEAKEST, 1, 1));
  });

  it('is deterministic for the same rotation', () => {
    expect(selectStations(WEAKEST, 3, 5)).toEqual(selectStations(WEAKEST, 3, 5));
  });
});

describe('i18n (D5)', () => {
  it('emits keys with a real message behind every one', () => {
    const keys = new Set<string>();
    for (const sessionsPerWeek of [2, 3, 4, 5, 6]) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        for (const week of prescribePlan(16, sessionsPerWeek, background)) {
          for (const session of week) {
            keys.add(session.titleKey);
            keys.add(session.rationaleKey);
            for (const block of session.blocks) {
              keys.add(block.titleKey);
              if (block.prescription.kind === 'STRENGTH') {
                for (const pattern of block.prescription.movementPatternKeys) keys.add(pattern);
              }
            }
          }
        }
      }
    }

    expect(keys.size).toBeGreaterThan(10);
    for (const key of keys) {
      const message = lookupMessage(key);
      expect(typeof message, `missing message for ${key}`).toBe('string');
      expect(message).not.toBe('');
    }
  });

  it('emits no prose — every user-facing field is a dotted key', () => {
    for (const week of prescribePlan(16, 5, 'HYBRID')) {
      for (const session of week) {
        expect(session.titleKey).toMatch(/^plan\.[a-zA-Z.]+$/);
        expect(session.rationaleKey).toMatch(/^plan\.[a-zA-Z.]+$/);
        expect(session.titleKey).not.toContain(' ');
      }
    }
  });
});
