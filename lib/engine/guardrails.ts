import type { PlannedSession } from './prescribe';
import type { AthleticBackground, PhaseType } from './types';

/**
 * Safety guardrails (PRD §F8).
 *
 * "Hard constraints enforced by a validation pass over every generated plan.
 * These throw in tests. A plan that violates one is a P0 bug."
 *
 * **This is deliberately a second implementation.** Several guardrails are
 * already satisfied by construction in `progression/volume.ts` and
 * `prescribe.ts` — the volume ceiling by arithmetic, the rest day by the
 * template, the simulation window at generation. A validator that imported
 * those helpers would be checking the generator against itself and would pass
 * no matter how wrong the generator was. Everything below is re-derived from
 * the emitted sessions, using nothing but the session list. The duplication
 * is the point.
 *
 * **§F8 rule 8 is not implemented here, and that is correct** (ERRATA F18).
 * "Manual overrides are logged with the rule violated and display a warning"
 * is a UI and logging requirement; no function over a `Plan` can observe it.
 * §F8 is 7 validatable rules plus 1 process requirement. See
 * {@link PROCESS_ONLY_RULES}.
 */

export const GUARDRAIL_RULES = [
  'VOLUME_CEILING',
  'SESSION_COUNT_RAMP',
  'DELOAD_CADENCE',
  'WEEKLY_REST_DAY',
  'SIMULATION_RACE_PROXIMITY',
  'GATE_HAS_FALLBACK',
  'INSUFFICIENT_RUNWAY_ROUTING',
  'BEGINNER_CONSECUTIVE_INTENSITY',
] as const;

export type GuardrailRule = (typeof GUARDRAIL_RULES)[number];

/** §F8 rules that cannot be checked against a plan object (ERRATA F18). */
export const PROCESS_ONLY_RULES = ['OVERRIDE_LOGGING'] as const;

export interface GuardrailViolation {
  readonly rule: GuardrailRule;
  /** i18n key explaining the breach to a human (D5). */
  readonly messageKey: string;
  readonly weekIndex?: number;
  readonly dayOffset?: number;
  readonly detail: Readonly<Record<string, number | string>>;
}

export interface ValidatablePlan {
  readonly weeks: number;
  readonly background: AthleticBackground;
  /**
   * Whole weeks to race, or null for a rolling plan (D4). Rule 7 checks this
   * against the plan's kind.
   */
  readonly weeksToRace: number | null;
  /** Seven sessions per week, week 1 first. */
  readonly sessionsByWeek: readonly (readonly PlannedSession[])[];
}

export class GuardrailViolationError extends Error {
  constructor(readonly violations: readonly GuardrailViolation[]) {
    super(
      `Plan violates ${violations.length} safety guardrail(s): ${violations
        .map((violation) => `${violation.rule}${violation.weekIndex === undefined ? '' : ` (week ${violation.weekIndex})`}`)
        .join(', ')}. This is a P0 bug.`,
    );
    this.name = 'GuardrailViolationError';
  }
}

// --- Constants, restated rather than imported (see the note above). ---

const CEILING_FACTOR_DEFAULT = 1.1;
const CEILING_FACTOR_RUNNER = 1.05;
const ROLLING_WINDOW = 3;
const MAX_SESSION_INCREASE = 1;
const DELOAD_EVERY = 4;
const DELOAD_SUPPRESSION_WEEKS = 3;
/** A week at or below this share of the rolling max reads as a deload. */
const DELOAD_DETECTION_THRESHOLD = 0.75;
const SIMULATION_EXCLUSION_DAYS = 10;
const DAYS_PER_WEEK = 7;

/**
 * Sessions treated as high intensity for §7.4's BEGINNER adjacency rule.
 *
 * **Provisional** (ERRATA F17). §7.4 says "never two consecutive
 * high-intensity days for BEGINNER" but never defines the set against the
 * session-type enum. These three are unambiguous. Strength work is excluded
 * because the engine does not currently model heavy versus light lifting —
 * if F17 resolves that it should count, this constant is the only edit.
 */
export const HIGH_INTENSITY_SESSION_TYPES = [
  'INTERVAL_RUN',
  'COMPROMISED_RUN',
  'RACE_SIMULATION',
] as const;

/**
 * Running metres in a session, re-derived from its blocks.
 *
 * Independent of `prescribe.weeklyRunningMetres` on purpose: if both read the
 * same helper, a bug in that helper would hide from the validator.
 */
function runningMetresIn(session: PlannedSession): number {
  let total = 0;
  for (const block of session.blocks) {
    const p = block.prescription;
    if (p.kind === 'RUN') total += p.distanceM;
    else if (p.kind === 'INTERVALS') total += p.reps * p.repDistanceM;
    else if (p.kind === 'COMPROMISED_ROUNDS') total += p.rounds * p.runDistanceM;
    else if (p.kind === 'SIMULATION') total += p.runDistanceM;
  }
  return total;
}

function weeklyMetres(week: readonly PlannedSession[]): number {
  return week.reduce((total, session) => total + runningMetresIn(session), 0);
}

function phaseOf(week: readonly PlannedSession[]): PhaseType | null {
  return week[0]?.phase ?? null;
}

// --- Rule 1: running volume ceiling ---

function checkVolumeCeiling(plan: ValidatablePlan): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  const factor =
    plan.background === 'RUNNER' ? CEILING_FACTOR_RUNNER : CEILING_FACTOR_DEFAULT;
  const metres = plan.sessionsByWeek.map(weeklyMetres);

  for (let index = 1; index < metres.length; index += 1) {
    const window = metres.slice(Math.max(0, index - ROLLING_WINDOW), index);
    const rollingMax = Math.max(...window);
    const current = metres[index] ?? 0;
    // One metre of slack for integer rounding, not for real overshoot.
    const ceiling = rollingMax * factor + 1;

    if (current > ceiling) {
      violations.push({
        rule: 'VOLUME_CEILING',
        messageKey: 'guardrail.volumeCeiling',
        weekIndex: index + 1,
        detail: {
          plannedM: current,
          rollingMaxM: rollingMax,
          ceilingM: Math.round(ceiling),
          factor,
        },
      });
    }
  }

  return violations;
}

// --- Rule 2: session count ramp ---

function checkSessionCountRamp(plan: ValidatablePlan): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  const counts = plan.sessionsByWeek.map(
    (week) => week.filter((session) => session.type !== 'REST').length,
  );

  for (let index = 1; index < counts.length; index += 1) {
    const previous = counts[index - 1] ?? 0;
    const current = counts[index] ?? 0;
    if (current - previous > MAX_SESSION_INCREASE) {
      violations.push({
        rule: 'SESSION_COUNT_RAMP',
        messageKey: 'guardrail.sessionCountRamp',
        weekIndex: index + 1,
        detail: { previous, current, maxIncrease: MAX_SESSION_INCREASE },
      });
    }
  }

  return violations;
}

// --- Rule 3: deload cadence and suppression ---

function checkDeloadCadence(plan: ValidatablePlan): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  const metres = plan.sessionsByWeek.map(weeklyMetres);
  const totalWeeks = plan.sessionsByWeek.length;

  for (let index = 1; index < metres.length; index += 1) {
    const weekIndex = index + 1;
    const week = plan.sessionsByWeek[index];
    if (week === undefined) continue;
    const phase = phaseOf(week);

    // The taper is a deliberate cut, not a deload, so it is exempt.
    if (phase === 'TAPER') continue;

    const window = metres.slice(Math.max(0, index - ROLLING_WINDOW), index);
    const rollingMax = Math.max(...window);
    if (rollingMax <= 0) continue;

    const current = metres[index] ?? 0;
    const looksLikeDeload = current <= rollingMax * DELOAD_DETECTION_THRESHOLD;
    const weeksRemaining = totalWeeks - weekIndex;

    if (looksLikeDeload) {
      // Suppression: never in Race-Specific, never within 3 weeks of the race.
      if (phase === 'RACE_SPECIFIC') {
        violations.push({
          rule: 'DELOAD_CADENCE',
          messageKey: 'guardrail.deloadInRaceSpecific',
          weekIndex,
          detail: { plannedM: current, rollingMaxM: rollingMax },
        });
      } else if (weeksRemaining <= DELOAD_SUPPRESSION_WEEKS) {
        // This is the v0.1 bug: a deload beside the taper gives two easy
        // weeks back to back before race day.
        violations.push({
          rule: 'DELOAD_CADENCE',
          messageKey: 'guardrail.deloadNearRace',
          weekIndex,
          detail: { plannedM: current, rollingMaxM: rollingMax, weeksRemaining },
        });
      }
    } else if (
      weekIndex % DELOAD_EVERY === 0 &&
      phase !== 'RACE_SPECIFIC' &&
      weeksRemaining > DELOAD_SUPPRESSION_WEEKS
    ) {
      // The cadence is a requirement, not just a permission: an unsuppressed
      // 4th week that never drops means the athlete never unloads.
      violations.push({
        rule: 'DELOAD_CADENCE',
        messageKey: 'guardrail.deloadMissing',
        weekIndex,
        detail: { plannedM: current, rollingMaxM: rollingMax },
      });
    }
  }

  return violations;
}

// --- Rule 4: one full rest day a week ---

function checkWeeklyRestDay(plan: ValidatablePlan): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  plan.sessionsByWeek.forEach((week, index) => {
    const restDays = week.filter((session) => session.type === 'REST').length;
    if (restDays < 1) {
      violations.push({
        rule: 'WEEKLY_REST_DAY',
        messageKey: 'guardrail.weeklyRestDay',
        weekIndex: index + 1,
        detail: { restDays, sessions: week.length },
      });
    }
  });

  return violations;
}

// --- Rule 5: no simulation near race day ---

function checkSimulationProximity(plan: ValidatablePlan): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  if (plan.weeksToRace === null) return violations;

  const raceDayOffset = plan.weeks * DAYS_PER_WEEK - 1;

  for (const week of plan.sessionsByWeek) {
    for (const session of week) {
      if (session.type !== 'RACE_SIMULATION') continue;
      const daysBefore = raceDayOffset - session.dayOffset;
      if (daysBefore < SIMULATION_EXCLUSION_DAYS) {
        violations.push({
          rule: 'SIMULATION_RACE_PROXIMITY',
          messageKey: 'guardrail.simulationNearRace',
          weekIndex: session.weekIndex,
          dayOffset: session.dayOffset,
          detail: { daysBeforeRace: daysBefore, minimumDays: SIMULATION_EXCLUSION_DAYS },
        });
      }
    }
  }

  return violations;
}

// --- Rule 6: every gate carries a usable fallback ---

function checkGateFallbacks(plan: ValidatablePlan): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  for (const week of plan.sessionsByWeek) {
    for (const session of week) {
      const gate = session.gate;
      if (gate === null || gate === undefined) continue;

      const fallback: unknown = gate.fallbackType;
      const invalid =
        typeof fallback !== 'string' ||
        fallback === '' ||
        fallback === session.type ||
        fallback === 'REST' ||
        !Number.isFinite(gate.condition?.value) ||
        gate.condition.value <= 0;

      if (invalid) {
        violations.push({
          rule: 'GATE_HAS_FALLBACK',
          messageKey: 'guardrail.gateWithoutFallback',
          weekIndex: session.weekIndex,
          dayOffset: session.dayOffset,
          detail: {
            sessionType: session.type,
            fallbackType: typeof fallback === 'string' ? fallback : 'MISSING',
          },
        });
      }
    }
  }

  return violations;
}

// --- Rule 7: short runways must not reach a standard plan ---

function checkRunwayRouting(plan: ValidatablePlan): GuardrailViolation[] {
  if (plan.weeksToRace === null || plan.weeksToRace > 4) return [];

  return [
    {
      rule: 'INSUFFICIENT_RUNWAY_ROUTING',
      messageKey: 'guardrail.insufficientRunwayRouting',
      detail: { weeksToRace: plan.weeksToRace },
    },
  ];
}

// --- §7.4: BEGINNER consecutive high-intensity days ---

function checkBeginnerIntensityAdjacency(plan: ValidatablePlan): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  if (plan.background !== 'BEGINNER') return violations;

  const isHighIntensity = (session: PlannedSession): boolean =>
    (HIGH_INTENSITY_SESSION_TYPES as readonly string[]).includes(session.type);

  // Flattened across the whole plan, so week boundaries are checked too — day
  // 6 of one week is adjacent to day 0 of the next (ERRATA F31).
  const ordered = plan.sessionsByWeek.flat().slice().sort((a, b) => a.dayOffset - b.dayOffset);

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous === undefined || current === undefined) continue;
    if (current.dayOffset !== previous.dayOffset + 1) continue;

    if (isHighIntensity(previous) && isHighIntensity(current)) {
      violations.push({
        rule: 'BEGINNER_CONSECUTIVE_INTENSITY',
        messageKey: 'guardrail.beginnerConsecutiveIntensity',
        weekIndex: current.weekIndex,
        dayOffset: current.dayOffset,
        detail: { previousType: previous.type, currentType: current.type },
      });
    }
  }

  return violations;
}

/** Runs every validatable guardrail. Empty array means the plan is safe. */
export function validatePlan(plan: ValidatablePlan): readonly GuardrailViolation[] {
  return Object.freeze([
    ...checkVolumeCeiling(plan),
    ...checkSessionCountRamp(plan),
    ...checkDeloadCadence(plan),
    ...checkWeeklyRestDay(plan),
    ...checkSimulationProximity(plan),
    ...checkGateFallbacks(plan),
    ...checkRunwayRouting(plan),
    ...checkBeginnerIntensityAdjacency(plan),
  ]);
}

/**
 * Throws unless the plan is safe.
 *
 * Call before any plan reaches an athlete. A guardrail breach is a P0 bug,
 * not a warning to render (CLAUDE.md rule 2).
 */
export function assertPlanValid(plan: ValidatablePlan): void {
  const violations = validatePlan(plan);
  if (violations.length > 0) throw new GuardrailViolationError(violations);
}
