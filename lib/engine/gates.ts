import type { SessionType } from './templates';

/**
 * Gated sessions (PRD §7.5, as amended by ERRATA F14 and F15).
 *
 * The problem this solves: "no intervals until a 30-minute continuous run is
 * logged" is circular against a plan generated up front. The engine emits a
 * gate plus a fallback, and resolution happens at read time. Identical inputs
 * still emit identical gates, so the plan stays deterministic while the
 * *served* session responds to real progress.
 *
 * **Latching is structural, not a flag.** Every field of {@link GateProgress}
 * is monotonic — a maximum, a count, or elapsed time — so a satisfied
 * condition can never become unsatisfied. That answers F14's "does the unlock
 * flap?" without a latch bit to keep in sync, and it means gate resolution is
 * a pure function of current progress.
 */

export const UNLOCK_CONDITION_TYPES = [
  'CONTINUOUS_RUN_MINUTES',
  'COMPROMISED_RUNS_COMPLETED',
  'WEEKS_ELAPSED',
] as const;

export type UnlockConditionType = (typeof UNLOCK_CONDITION_TYPES)[number];

export interface UnlockCondition {
  readonly type: UnlockConditionType;
  readonly value: number;
}

/**
 * A gate: what must be true, and what is served until it is.
 *
 * The fallback is a required field rather than an optional one, which makes
 * guardrail 6 — "gated sessions must always carry a valid fallback" —
 * unbreakable by construction rather than checked after the fact.
 */
export interface Gate {
  readonly condition: UnlockCondition;
  readonly fallbackType: SessionType;
}

/**
 * Monotonic progress accumulators.
 *
 * `longestContinuousRunSecs` is a *maximum ever achieved*, not a recent
 * value, and it is seeded from the onboarding baseline (F14) — a beginner who
 * already runs 35 minutes must not be gated out of intervals in week 1 for
 * lack of a log entry.
 */
export interface GateProgress {
  readonly longestContinuousRunSecs: number;
  readonly compromisedRunsCompleted: number;
  readonly weeksElapsed: number;
}

/** Default number of compromised runs before a full race simulation. */
export const DEFAULT_COMPROMISED_RUN_THRESHOLD = 3;

/** A simulation always requires at least one rehearsal, however short the plan. */
export const MIN_COMPROMISED_RUN_THRESHOLD = 1;

/** Continuous-run requirement before a BEGINNER is given intervals (§7.5). */
export const BEGINNER_INTERVAL_UNLOCK_MINUTES = 30;

const SECONDS_PER_MINUTE = 60;

export class InvalidGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGateError';
  }
}

/**
 * Seeds progress from the onboarding baseline (ERRATA F14).
 *
 * @param longestRunMins the athlete's longest continuous run in the last
 *   month, from §F1 step 3
 */
export function seedGateProgress(longestRunMins: number): GateProgress {
  if (!Number.isFinite(longestRunMins) || longestRunMins < 0) {
    throw new RangeError(`longestRunMins must be a non-negative number, received ${longestRunMins}.`);
  }
  return {
    longestContinuousRunSecs: Math.round(longestRunMins * SECONDS_PER_MINUTE),
    compromisedRunsCompleted: 0,
    weeksElapsed: 0,
  };
}

/**
 * The compromised-run threshold for a plan's race simulations (ERRATA F15).
 *
 * The PRD's flat threshold of 3 is unreachable in short plans: a 6-week plan
 * has two Build weeks and therefore two compromised runs before Race-Specific,
 * so the simulation gate would never open and the athlete would never rehearse
 * the race at all. Scaling to what the plan actually schedules keeps the
 * safety intent — you must have done the preparatory work that exists — while
 * staying reachable.
 *
 * Never returns 0: a simulation without a single rehearsal is exactly what the
 * gate exists to prevent.
 */
export function compromisedRunThreshold(scheduledBeforeFirstSimulation: number): number {
  if (!Number.isInteger(scheduledBeforeFirstSimulation) || scheduledBeforeFirstSimulation < 0) {
    throw new RangeError(
      `scheduledBeforeFirstSimulation must be a non-negative integer, received ${scheduledBeforeFirstSimulation}.`,
    );
  }
  return Math.max(
    MIN_COMPROMISED_RUN_THRESHOLD,
    Math.min(DEFAULT_COMPROMISED_RUN_THRESHOLD, scheduledBeforeFirstSimulation),
  );
}

/** Validates a gate, so an unservable session cannot reach a plan. */
export function assertValidGate(gate: Gate, plannedType: SessionType): void {
  if (!UNLOCK_CONDITION_TYPES.includes(gate.condition.type)) {
    throw new InvalidGateError(`Unknown unlock condition type ${gate.condition.type}.`);
  }
  if (!Number.isFinite(gate.condition.value) || gate.condition.value <= 0) {
    throw new InvalidGateError(
      `Unlock condition ${gate.condition.type} needs a positive threshold, received ${gate.condition.value}.`,
    );
  }
  if (gate.fallbackType === plannedType) {
    throw new InvalidGateError(
      `A gate's fallback must differ from the session it replaces (${plannedType}).`,
    );
  }
  if (gate.fallbackType === 'REST') {
    throw new InvalidGateError(
      'A gate must fall back to real work, not REST — a locked session should still train something.',
    );
  }
}

/** True if progress satisfies the condition. Monotonic, so never re-locks. */
export function isSatisfied(condition: UnlockCondition, progress: GateProgress): boolean {
  switch (condition.type) {
    case 'CONTINUOUS_RUN_MINUTES':
      return progress.longestContinuousRunSecs >= condition.value * SECONDS_PER_MINUTE;
    case 'COMPROMISED_RUNS_COMPLETED':
      return progress.compromisedRunsCompleted >= condition.value;
    case 'WEEKS_ELAPSED':
      return progress.weeksElapsed >= condition.value;
  }
}

export interface GatedSession {
  readonly plannedType: SessionType;
  readonly gate: Gate | null;
}

export interface ResolvedSession {
  /** What the athlete is actually served today. */
  readonly type: SessionType;
  readonly locked: boolean;
  /** The unmet condition, for explaining why. Null when unlocked or ungated. */
  readonly pendingCondition: UnlockCondition | null;
}

/** Resolves a planned session against progress, at read time. */
export function resolveSession(session: GatedSession, progress: GateProgress): ResolvedSession {
  if (session.gate === null) {
    return { type: session.plannedType, locked: false, pendingCondition: null };
  }

  assertValidGate(session.gate, session.plannedType);

  if (isSatisfied(session.gate.condition, progress)) {
    return { type: session.plannedType, locked: false, pendingCondition: null };
  }

  return {
    type: session.gate.fallbackType,
    locked: true,
    pendingCondition: session.gate.condition,
  };
}

/**
 * Applies a completed session to the progress accumulators.
 *
 * **Fallback completions count** (ERRATA F15). A locked race simulation falls
 * back to a compromised run, and completing it is genuine transition practice
 * — refusing to count it would be perverse. This cannot self-unlock: progress
 * is read before the day's session is served, so the increment only ever
 * affects a later session.
 *
 * @param completedType the session actually performed, fallback or not
 * @param continuousRunSecs unbroken running time in the session, which for a
 *   run/walk beginner is strictly less than session duration (ERRATA F14)
 */
export function applyCompletion(
  progress: GateProgress,
  completedType: SessionType,
  continuousRunSecs = 0,
): GateProgress {
  if (!Number.isFinite(continuousRunSecs) || continuousRunSecs < 0) {
    throw new RangeError(
      `continuousRunSecs must be a non-negative number, received ${continuousRunSecs}.`,
    );
  }

  return {
    longestContinuousRunSecs: Math.max(progress.longestContinuousRunSecs, continuousRunSecs),
    compromisedRunsCompleted:
      progress.compromisedRunsCompleted + (completedType === 'COMPROMISED_RUN' ? 1 : 0),
    weeksElapsed: progress.weeksElapsed,
  };
}

/** Advances elapsed weeks. Separate from completion: time passes regardless. */
export function advanceWeeks(progress: GateProgress, weeks: number): GateProgress {
  if (!Number.isInteger(weeks) || weeks < 0) {
    throw new RangeError(`weeks must be a non-negative integer, received ${weeks}.`);
  }
  return { ...progress, weeksElapsed: progress.weeksElapsed + weeks };
}
