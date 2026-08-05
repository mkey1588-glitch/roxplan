import type { DateOnly } from '@/lib/date/dateOnly';
import type { Division, StationId } from '@/lib/seeds/types';

import type { PlanCalendar } from './calendar';
import { deriveRaceCalendar, deriveRollingCalendar } from './calendar';
import { assertSupportedDivision } from './errors';
import { compromisedRunThreshold } from './gates';
import type { ValidatablePlan } from './guardrails';
import { allocatePhases, hasSufficientRunway } from './phases';
import type { PlannedSession } from './prescribe';
import { prescribeWeek, weeklyRunningMetres } from './prescribe';
import { ceilingFactorFor, planWeeklyVolume, ROLLING_MAX_WEEKS } from './progression/volume';
import type { WeeklyVolume } from './progression/volume';
import type { ReadinessPlan } from './runway';
import { generateReadinessPlan } from './runway';
import type { AthleticBackground, PhaseAllocation } from './types';

/**
 * The engine's entry points (PRD §F3).
 *
 * Pure and deterministic: every input arrives as an argument, including the
 * reference date and the seed-derived station list. No clock, no network, no
 * randomness (CLAUDE.md rule 1).
 */

export interface GeneratePlanInput {
  /** Today in the athlete's timezone (D7). Never read from the clock. */
  readonly todayLocal: DateOnly;
  /** Null for a rolling plan with no race booked (D4). */
  readonly raceDate: DateOnly | null;
  readonly division: Division;
  readonly background: AthleticBackground;
  readonly sessionsPerWeek: number;
  /** From onboarding (ERRATA R3), in metres. */
  readonly currentWeeklyRunM: number;
  readonly baselineConfidence: 'HIGH' | 'LOW';
  /** Seeds the interval gate (ERRATA F14). */
  readonly longestRunMins: number;
  readonly weakestStations: readonly StationId[];
  /** Length of a rolling block when no race date is set (D4). */
  readonly rollingWeeks?: number;
}

export interface TrainingPlan {
  readonly kind: 'TRAINING';
  readonly calendar: PlanCalendar;
  readonly allocation: PhaseAllocation;
  readonly volumes: readonly WeeklyVolume[];
  readonly sessionsByWeek: readonly (readonly PlannedSession[])[];
}

export interface ReadinessPlanResult {
  readonly kind: 'READINESS';
  readonly calendar: PlanCalendar;
  readonly plan: ReadinessPlan;
}

export type GeneratedPlan = TrainingPlan | ReadinessPlanResult;

/** Default rolling block length (D4: rolling 4-week cycles). */
export const DEFAULT_ROLLING_WEEKS = 4;

function rollingMax(history: readonly number[]): number {
  return history.slice(-ROLLING_MAX_WEEKS).reduce((max, value) => Math.max(max, value), 0);
}

/**
 * Generates a plan.
 *
 * @throws UnsupportedDivisionError for Doubles, Mixed Doubles or Relay (D1)
 */
export function generatePlan(input: GeneratePlanInput): GeneratedPlan {
  assertSupportedDivision(input.division);

  const calendar =
    input.raceDate === null
      ? deriveRollingCalendar(input.todayLocal, input.rollingWeeks ?? DEFAULT_ROLLING_WEEKS)
      : deriveRaceCalendar(input.todayLocal, input.raceDate);

  // Guardrail 7: too little runway must route to the readiness path, never to
  // a standard plan.
  if (input.raceDate !== null && !hasSufficientRunway(calendar.weeks)) {
    return {
      kind: 'READINESS',
      calendar,
      plan: generateReadinessPlan(calendar, input.background),
    };
  }

  const weeks = calendar.weeks;
  const allocation = allocatePhases(weeks, input.background);
  const volumes = planWeeklyVolume({
    weeks,
    allocation,
    background: input.background,
    currentWeeklyRunM: input.currentWeeklyRunM,
    baselineConfidence: input.baselineConfidence,
  });

  const ceilingFactor = ceilingFactorFor(input.background);

  // Compromised runs are gated on rehearsal; the threshold scales to what this
  // plan can actually schedule (ERRATA F15).
  const hybridsBeforeRaceSpecific =
    allocation.FOUNDATION + allocation.BUILD > 0 ? allocation.BUILD : 0;
  const simulationGateThreshold = compromisedRunThreshold(hybridsBeforeRaceSpecific);

  const sessionsByWeek: (readonly PlannedSession[])[] = [];
  /**
   * Running metres actually prescribed, week by week.
   *
   * Guardrail 1 constrains what the athlete *does*, not what the budget model
   * intended. Granularity means a week can come in under budget — a compromised
   * run is a whole number of rounds, and a sub-kilometre run is dropped rather
   * than prescribed — and the next week must ramp from that lower reality, not
   * from the projection. Feeding measured volume back is what keeps the
   * emitted plan inside the ceiling rather than merely the model.
   */
  const measured: number[] = [];

  for (const volume of volumes) {
    const ceilingM =
      measured.length === 0
        ? volume.runningBudgetM
        : Math.floor(rollingMax(measured) * ceilingFactor);

    const sessions = prescribeWeek({
      weekIndex: volume.weekIndex,
      volume: { ...volume, runningBudgetM: Math.min(volume.runningBudgetM, ceilingM) },
      allocation,
      sessionsPerWeek: input.sessionsPerWeek,
      background: input.background,
      totalWeeks: weeks,
      weakestStations: input.weakestStations,
      simulationGateThreshold,
    });

    sessionsByWeek.push(sessions);
    measured.push(weeklyRunningMetres(sessions));
  }

  return {
    kind: 'TRAINING',
    calendar,
    allocation,
    volumes,
    sessionsByWeek: Object.freeze(sessionsByWeek),
  };
}

/** Shapes a generated training plan for the guardrail validator. */
export function toValidatablePlan(
  plan: TrainingPlan,
  background: AthleticBackground,
): ValidatablePlan {
  return {
    weeks: plan.calendar.weeks,
    background,
    weeksToRace: plan.calendar.raceDate === null ? null : plan.calendar.weeks,
    sessionsByWeek: plan.sessionsByWeek,
  };
}

export * from './calendar';
export * from './errors';
export * from './gates';
export * from './guardrails';
export * from './phases';
export * from './prescribe';
export * from './runway';
export * from './templates';
export * from './types';
