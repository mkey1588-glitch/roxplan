import { describe, expect, it } from 'vitest';

import enMessages from '@/messages/en.json';
import type { StationId } from '@/lib/seeds/types';

import { addDays, toDateOnly } from '@/lib/date/dateOnly';

import { assertSupportedDivision, UnsupportedDivisionError } from './errors';
import { generatePlan, toValidatablePlan } from './index';
import {
  assertPlanValid,
  GUARDRAIL_RULES,
  GuardrailViolationError,
  HIGH_INTENSITY_SESSION_TYPES,
  PROCESS_ONLY_RULES,
  validatePlan,
} from './guardrails';
import type { GuardrailRule, ValidatablePlan } from './guardrails';
import { allocatePhases, InsufficientRunwayError } from './phases';
import type { PlannedSession } from './prescribe';
import { ATHLETIC_BACKGROUNDS } from './types';
import type { AthleticBackground } from './types';

const WEAKEST: readonly StationId[] = ['WALL_BALLS', 'SLED_PUSH'];
const TODAY = toDateOnly('2026-08-05');

function buildPlan(
  weeks: number,
  sessionsPerWeek: number,
  background: AthleticBackground,
  currentWeeklyRunM = 20000,
): ValidatablePlan {
  // Goes through the real entry point rather than reassembling the pieces, so
  // the suite validates what actually ships.
  const generated = generatePlan({
    todayLocal: TODAY,
    raceDate: addDays(TODAY, weeks * 7 - 1),
    division: 'OPEN_SINGLES',
    background,
    sessionsPerWeek,
    currentWeeklyRunM,
    baselineConfidence: 'HIGH',
    longestRunMins: 40,
    weakestStations: WEAKEST,
  });

  if (generated.kind !== 'TRAINING') throw new Error('expected a training plan');
  return toValidatablePlan(generated, background);
}

const rulesIn = (plan: ValidatablePlan): GuardrailRule[] =>
  validatePlan(plan).map((violation) => violation.rule);

// ---------------------------------------------------------------------------
// Every plan the engine can generate must pass.
// ---------------------------------------------------------------------------

describe('generated plans are safe', () => {
  it('passes every guardrail across the full input space', () => {
    for (let weeks = 5; weeks <= 52; weeks += 1) {
      for (const sessionsPerWeek of [2, 3, 4, 5, 6]) {
        for (const background of ATHLETIC_BACKGROUNDS) {
          const plan = buildPlan(weeks, sessionsPerWeek, background);
          const violations = validatePlan(plan);
          expect(
            violations,
            `${weeks}w / ${sessionsPerWeek}d / ${background}: ${violations
              .map((v) => `${v.rule}@w${v.weekIndex}`)
              .join(', ')}`,
          ).toEqual([]);
        }
      }
    }
  });

  it('passes for low-volume and high-volume athletes alike', () => {
    for (const currentWeeklyRunM of [3000, 8000, 15000, 30000, 60000]) {
      for (const background of ATHLETIC_BACKGROUNDS) {
        expect(validatePlan(buildPlan(16, 4, background, currentWeeklyRunM))).toEqual([]);
      }
    }
  });

  it('does not throw from assertPlanValid', () => {
    expect(() => assertPlanValid(buildPlan(16, 5, 'HYBRID'))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Adversarial cases (KICKOFF §5). Each must be caught.
// ---------------------------------------------------------------------------

describe('adversarial: BEGINNER, 6 sessions/week, 4-week race window', () => {
  it('refuses to allocate phases at all', () => {
    expect(() => allocatePhases(4, 'BEGINNER')).toThrow(InsufficientRunwayError);
  });

  it('is caught by rule 7 if a plan is somehow constructed anyway', () => {
    const plan = buildPlan(8, 6, 'BEGINNER');
    const smuggled: ValidatablePlan = { ...plan, weeksToRace: 4 };
    expect(rulesIn(smuggled)).toContain('INSUFFICIENT_RUNWAY_ROUTING');
  });

  it.each([0, 1, 2, 3, 4])('catches a %i-week runway', (weeksToRace) => {
    const plan = { ...buildPlan(8, 6, 'BEGINNER'), weeksToRace };
    expect(rulesIn(plan)).toContain('INSUFFICIENT_RUNWAY_ROUTING');
  });
});

describe('adversarial: RUNNER whose volume jumps 30% week over week', () => {
  it('is caught by the volume ceiling', () => {
    const plan = buildPlan(16, 5, 'RUNNER');
    const weeks = plan.sessionsByWeek.map((week) => [...week]);

    // Inflate week 5's long run by 30% of the week's running.
    const target = weeks[4];
    if (target === undefined) throw new Error('missing week');
    const runIndex = target.findIndex((session) => session.blocks[0]?.prescription.kind === 'RUN');
    const session = target[runIndex];
    const block = session?.blocks[0];
    if (session === undefined || block === undefined || block.prescription.kind !== 'RUN') {
      throw new Error('expected a run session');
    }

    target[runIndex] = {
      ...session,
      blocks: [
        { ...block, prescription: { ...block.prescription, distanceM: block.prescription.distanceM + 9000 } },
      ],
    };

    expect(rulesIn({ ...plan, sessionsByWeek: weeks })).toContain('VOLUME_CEILING');
  });

  it('holds RUNNER to the tighter 105% ceiling than other backgrounds', () => {
    // A jump that a HYBRID could legally make must fail for a RUNNER.
    const makeWeeks = (metres: readonly number[]): readonly (readonly PlannedSession[])[] =>
      metres.map((distanceM, index) => [
        {
          dayOffset: index * 7,
          weekIndex: index + 1,
          phase: 'FOUNDATION' as const,
          type: 'EASY_RUN' as const,
          titleKey: 'plan.session.easyRun',
          rationaleKey: 'plan.rationale.aerobicBase',
          params: {},
          blocks: [
            {
              order: 1,
              titleKey: 'plan.block.steadyRun',
              prescription: { kind: 'RUN' as const, distanceM, zone: 'ZONE_2' as const },
            },
          ],
          gate: null,
        },
        ...Array.from({ length: 6 }, (_unused, day) => ({
          dayOffset: index * 7 + day + 1,
          weekIndex: index + 1,
          phase: 'FOUNDATION' as const,
          type: 'REST' as const,
          titleKey: 'plan.session.rest',
          rationaleKey: 'plan.rationale.rest',
          params: {},
          blocks: [
            { order: 1, titleKey: 'plan.block.rest', prescription: { kind: 'REST' as const } },
          ],
          gate: null,
        })),
      ]);

    // +8%: legal for HYBRID (cap 110%), illegal for RUNNER (cap 105%).
    const sessionsByWeek = makeWeeks([10000, 10800]);
    expect(
      rulesIn({ weeks: 2, background: 'HYBRID', weeksToRace: 12, sessionsByWeek }),
    ).not.toContain('VOLUME_CEILING');
    expect(
      rulesIn({ weeks: 2, background: 'RUNNER', weeksToRace: 12, sessionsByWeek }),
    ).toContain('VOLUME_CEILING');
  });
});

describe('adversarial: race simulation 5 days out', () => {
  it('is caught by rule 5', () => {
    const plan = buildPlan(16, 5, 'HYBRID');
    const weeks = plan.sessionsByWeek.map((week) => [...week]);

    const raceDayOffset = plan.weeks * 7 - 1;
    const lastWeek = weeks[weeks.length - 1];
    if (lastWeek === undefined) throw new Error('missing week');
    const victim = lastWeek[0];
    if (victim === undefined) throw new Error('missing session');

    lastWeek[0] = {
      ...victim,
      type: 'RACE_SIMULATION',
      dayOffset: raceDayOffset - 5,
      blocks: [
        {
          order: 1,
          titleKey: 'plan.block.simulation',
          prescription: { kind: 'SIMULATION', runDistanceM: 8000, stations: 8 },
        },
      ],
    };

    const violations = validatePlan({ ...plan, sessionsByWeek: weeks });
    const proximity = violations.find((v) => v.rule === 'SIMULATION_RACE_PROXIMITY');
    expect(proximity).toBeDefined();
    expect(proximity?.detail.daysBeforeRace).toBe(5);
  });

  it.each([0, 1, 5, 9])('catches a simulation %i days out', (daysOut) => {
    const plan = buildPlan(16, 5, 'HYBRID');
    const weeks = plan.sessionsByWeek.map((week) => [...week]);
    const lastWeek = weeks[weeks.length - 1];
    const victim = lastWeek?.[0];
    if (lastWeek === undefined || victim === undefined) throw new Error('missing session');

    lastWeek[0] = { ...victim, type: 'RACE_SIMULATION', dayOffset: plan.weeks * 7 - 1 - daysOut };
    expect(rulesIn({ ...plan, sessionsByWeek: weeks })).toContain('SIMULATION_RACE_PROXIMITY');
  });

  it('permits one exactly 10 days out', () => {
    const plan = buildPlan(16, 5, 'HYBRID');
    const weeks = plan.sessionsByWeek.map((week) => [...week]);
    const lastWeek = weeks[weeks.length - 1];
    const victim = lastWeek?.[0];
    if (lastWeek === undefined || victim === undefined) throw new Error('missing session');

    lastWeek[0] = { ...victim, type: 'RACE_SIMULATION', dayOffset: plan.weeks * 7 - 1 - 10 };
    expect(rulesIn({ ...plan, sessionsByWeek: weeks })).not.toContain(
      'SIMULATION_RACE_PROXIMITY',
    );
  });
});

describe('adversarial: deload week immediately before the taper', () => {
  it('is caught by rule 3', () => {
    const plan = buildPlan(16, 5, 'HYBRID');
    const weeks = plan.sessionsByWeek.map((week) => [...week]);

    // Gut the week before the taper: this is the v0.1 bug, two easy weeks
    // back to back into race day.
    const preTaperIndex = weeks.length - 2;
    const preTaper = weeks[preTaperIndex];
    if (preTaper === undefined) throw new Error('missing week');

    weeks[preTaperIndex] = preTaper.map((session) =>
      session.type === 'REST'
        ? session
        : {
            ...session,
            blocks: session.blocks.map((block) =>
              block.prescription.kind === 'RUN'
                ? { ...block, prescription: { ...block.prescription, distanceM: 500 } }
                : block,
            ),
          },
    );

    expect(rulesIn({ ...plan, sessionsByWeek: weeks })).toContain('DELOAD_CADENCE');
  });

  it('catches a missing deload as well as a misplaced one', () => {
    // The cadence is a requirement, not a permission: flatten a 20-week plan
    // so no week ever drops, and week 4 should be reported.
    const plan = buildPlan(20, 5, 'HYBRID');
    const flat = plan.sessionsByWeek.map((week, index) =>
      week.map((session) => ({
        ...session,
        blocks: session.blocks.map((block) =>
          block.prescription.kind === 'RUN'
            ? { ...block, prescription: { ...block.prescription, distanceM: 5000 } }
            : block,
        ),
        weekIndex: index + 1,
      })),
    );

    const violations = validatePlan({ ...plan, sessionsByWeek: flat });
    const missing = violations.filter((v) => v.messageKey === 'guardrail.deloadMissing');
    expect(missing.length).toBeGreaterThan(0);
  });
});

describe('adversarial: gated session with no fallback', () => {
  it('is caught by rule 6', () => {
    const plan = buildPlan(20, 5, 'BEGINNER');
    const weeks = plan.sessionsByWeek.map((week) => [...week]);

    let patched = false;
    for (const week of weeks) {
      for (let index = 0; index < week.length; index += 1) {
        const session = week[index];
        if (session === undefined || session.gate === null) continue;
        week[index] = {
          ...session,
          // Simulating a schema that let fallback go missing (ERRATA F12).
          gate: { ...session.gate, fallbackType: undefined as never },
        };
        patched = true;
        break;
      }
      if (patched) break;
    }
    expect(patched).toBe(true);

    expect(rulesIn({ ...plan, sessionsByWeek: weeks })).toContain('GATE_HAS_FALLBACK');
  });

  it('rejects a fallback that is the gated session itself', () => {
    const plan = buildPlan(20, 5, 'BEGINNER');
    const weeks = plan.sessionsByWeek.map((week) => [...week]);

    for (const week of weeks) {
      for (let index = 0; index < week.length; index += 1) {
        const session = week[index];
        if (session === undefined || session.gate === null) continue;
        week[index] = { ...session, gate: { ...session.gate, fallbackType: session.type } };
      }
    }

    expect(rulesIn({ ...plan, sessionsByWeek: weeks })).toContain('GATE_HAS_FALLBACK');
  });

  it('rejects a fallback of REST — a locked session should still train', () => {
    const plan = buildPlan(20, 5, 'BEGINNER');
    const weeks = plan.sessionsByWeek.map((week) => [...week]);

    for (const week of weeks) {
      for (let index = 0; index < week.length; index += 1) {
        const session = week[index];
        if (session === undefined || session.gate === null) continue;
        week[index] = { ...session, gate: { ...session.gate, fallbackType: 'REST' } };
      }
    }

    expect(rulesIn({ ...plan, sessionsByWeek: weeks })).toContain('GATE_HAS_FALLBACK');
  });
});

describe('adversarial: DOUBLES division requested', () => {
  it.each(['DOUBLES', 'MIXED_DOUBLES', 'RELAY'] as const)('throws for %s', (division) => {
    expect(() => assertSupportedDivision(division)).toThrow(UnsupportedDivisionError);
  });
});

describe('adversarial: a week with no rest day', () => {
  it('is caught by rule 4', () => {
    const plan = buildPlan(16, 6, 'HYBRID');
    const weeks = plan.sessionsByWeek.map((week) =>
      week.map((session) =>
        session.type === 'REST'
          ? { ...session, type: 'RECOVERY_MOBILITY' as const }
          : session,
      ),
    );

    expect(rulesIn({ ...plan, sessionsByWeek: weeks })).toContain('WEEKLY_REST_DAY');
  });
});

describe('adversarial: session count jumping by more than one', () => {
  it('is caught by rule 2', () => {
    const plan = buildPlan(16, 2, 'HYBRID');
    const weeks = plan.sessionsByWeek.map((week, index) =>
      index === 3
        ? week.map((session) =>
            session.type === 'REST'
              ? { ...session, type: 'RECOVERY_MOBILITY' as const }
              : session,
          )
        : week,
    );

    expect(rulesIn({ ...plan, sessionsByWeek: weeks })).toContain('SESSION_COUNT_RAMP');
  });
});

describe('adversarial: BEGINNER with back-to-back hard days', () => {
  it('is caught, including across a week boundary (ERRATA F31)', () => {
    const plan = buildPlan(16, 5, 'BEGINNER');
    const weeks = plan.sessionsByWeek.map((week) => [...week]);

    // Put a compromised run on the last day of week 2 and the first day of
    // week 3 — adjacent days that sit either side of a week boundary.
    const first = weeks[1];
    const second = weeks[2];
    if (first === undefined || second === undefined) throw new Error('missing weeks');

    const lastOfFirst = first.length - 1;
    const lastSession = first[lastOfFirst];
    const firstSession = second[0];
    if (lastSession === undefined || firstSession === undefined) throw new Error('missing sessions');

    first[lastOfFirst] = { ...lastSession, type: 'COMPROMISED_RUN' };
    second[0] = { ...firstSession, type: 'INTERVAL_RUN' };

    const violations = validatePlan({ ...plan, sessionsByWeek: weeks });
    const adjacency = violations.find((v) => v.rule === 'BEGINNER_CONSECUTIVE_INTENSITY');
    expect(adjacency).toBeDefined();
    expect(adjacency?.dayOffset).toBe(firstSession.dayOffset);
  });

  it('applies only to BEGINNER', () => {
    for (const background of ['RUNNER', 'STRENGTH', 'HYBRID'] as const) {
      const plan = buildPlan(16, 5, background);
      const weeks = plan.sessionsByWeek.map((week) => [...week]);
      const target = weeks[1];
      if (target === undefined) throw new Error('missing week');
      target[0] = { ...target[0]!, type: 'COMPROMISED_RUN' };
      target[1] = { ...target[1]!, type: 'INTERVAL_RUN' };

      expect(rulesIn({ ...plan, sessionsByWeek: weeks })).not.toContain(
        'BEGINNER_CONSECUTIVE_INTENSITY',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The validator's own contract.
// ---------------------------------------------------------------------------

describe('validator contract', () => {
  it('throws GuardrailViolationError with every violation attached', () => {
    const plan = { ...buildPlan(16, 5, 'HYBRID'), weeksToRace: 3 };
    try {
      assertPlanValid(plan);
      throw new Error('expected assertPlanValid to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GuardrailViolationError);
      if (!(error instanceof GuardrailViolationError)) throw error;
      expect(error.violations.length).toBeGreaterThan(0);
      expect(error.message).toContain('P0');
    }
  });

  it('excludes override logging, which no plan check can observe (ERRATA F18)', () => {
    expect(PROCESS_ONLY_RULES).toContain('OVERRIDE_LOGGING');
    expect(GUARDRAIL_RULES as readonly string[]).not.toContain('OVERRIDE_LOGGING');
  });

  it('names the provisional high-intensity set in one place (ERRATA F17)', () => {
    expect([...HIGH_INTENSITY_SESSION_TYPES]).toEqual([
      'INTERVAL_RUN',
      'COMPROMISED_RUN',
      'RACE_SIMULATION',
    ]);
  });

  it('has a real message behind every violation key (D5)', () => {
    const plan = { ...buildPlan(16, 5, 'HYBRID'), weeksToRace: 2 };
    const keys = new Set(validatePlan(plan).map((violation) => violation.messageKey));
    expect(keys.size).toBeGreaterThan(0);

    for (const key of keys) {
      const message = key
        .split('.')
        .reduce<unknown>(
          (node, segment) =>
            typeof node === 'object' && node !== null
              ? (node as Record<string, unknown>)[segment]
              : undefined,
          enMessages,
        );
      expect(typeof message, `missing message for ${key}`).toBe('string');
    }
  });

  it('is deterministic', () => {
    const plan = buildPlan(16, 5, 'BEGINNER');
    expect(validatePlan(plan)).toEqual(validatePlan(plan));
  });
});
