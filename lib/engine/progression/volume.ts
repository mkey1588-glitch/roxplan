import type { AthleticBackground, PhaseAllocation, PhaseType } from '../types';
import { phaseForWeek } from '../phases';

/**
 * Weekly running budget (ERRATA R2, PRD guardrails 1 and 3).
 *
 * **Budget first.** The engine decides how many running metres a week may
 * contain *before* it decides what sessions fill them. Generating sessions and
 * totalling them afterwards is what let §7.2's simulation cadence collide with
 * F8.1's volume ceiling — an 8km simulation dropped on top of a normal week is
 * a ~130% jump. Deciding the budget first makes guardrail 1 satisfiable by
 * construction rather than by retry.
 *
 * The other consequence is that guardrail 1 holds *by arithmetic*: each week's
 * budget is `rollingMax × growthFactor`, and every growth factor is strictly
 * below the ceiling multiplier. There is no path through this function that
 * produces a violating week.
 */

/** Guardrail 1: planned weekly running may not exceed this share of the 3-week max. */
export const VOLUME_CEILING_FACTOR = 1.1;

/** Guardrail 1, `RUNNER` profiles: their absolute volume is already high. */
export const RUNNER_VOLUME_CEILING_FACTOR = 1.05;

/** Weeks of history the ceiling looks back over. */
export const ROLLING_MAX_WEEKS = 3;

/** Guardrail 3: a deload cuts volume by 40%. */
export const DELOAD_VOLUME_FACTOR = 0.6;

/** Guardrail 3: deloads land every 4th week, counted from plan start (F16). */
export const DELOAD_INTERVAL_WEEKS = 4;

/** Guardrail 3: no deload this close to race day, inclusive (F16). */
export const DELOAD_SUPPRESSION_WEEKS = 3;

/** §7.2: the taper cuts volume 40-50%. */
export const TAPER_VOLUME_FACTOR = 0.55;

/** D2: a self-reported baseline starts 15% lower than claimed. */
export const LOW_CONFIDENCE_FACTOR = 0.85;

/**
 * Headroom kept below the ceiling, so the plan never grows *to* the limit.
 *
 * A `RUNNER` in Foundation would otherwise grow at exactly their 1.05 cap,
 * leaving zero slack — and because the validator re-derives volume from the
 * emitted sessions, integer rounding makes measured metres a hair under the
 * budget, which tightens the next week's ceiling just enough to breach it.
 * Planning to the exact edge of a safety rule is the wrong habit anyway.
 */
export const CEILING_SAFETY_MARGIN = 0.01;

/**
 * Week-on-week growth by phase, all strictly below the ceiling multiplier.
 *
 * Race-Specific holds rather than grows: the load there comes from
 * specificity and simulation, not from more metres.
 */
const PHASE_GROWTH: Readonly<Record<PhaseType, number>> = {
  FOUNDATION: 1.08,
  BUILD: 1.06,
  RACE_SPECIFIC: 1.0,
  TAPER: TAPER_VOLUME_FACTOR,
};

export interface WeeklyVolume {
  /** 1-based week index within the plan. */
  readonly weekIndex: number;
  readonly phase: PhaseType;
  /** Total planned running metres for the week, every metre included. */
  readonly runningBudgetM: number;
  readonly isDeload: boolean;
  /** The ceiling that applied, for the guardrail validator to check against. */
  readonly ceilingM: number;
}

export interface VolumePlanInput {
  readonly weeks: number;
  readonly allocation: PhaseAllocation;
  readonly background: AthleticBackground;
  /** From onboarding (ERRATA R3), in metres. */
  readonly currentWeeklyRunM: number;
  /** D2: LOW for a self-reported baseline. */
  readonly baselineConfidence: 'HIGH' | 'LOW';
  /** False for a rolling block (D4); changes deload suppression. */
  readonly hasRaceDate?: boolean;
}

/** The ceiling multiplier for a background (guardrail 1). */
export function ceilingFactorFor(background: AthleticBackground): number {
  return background === 'RUNNER' ? RUNNER_VOLUME_CEILING_FACTOR : VOLUME_CEILING_FACTOR;
}

/**
 * Whether a week is a deload (guardrail 3).
 *
 * Suppressed in Race-Specific and Taper, and within 3 weeks of race day.
 * Suppressed deloads are **dropped, not deferred** (F16): deferring one would
 * push it into exactly the window the suppression exists to protect.
 */
export function isDeloadWeek(
  weekIndex: number,
  phase: PhaseType,
  totalWeeks: number,
  hasRaceDate = true,
): boolean {
  if (weekIndex % DELOAD_INTERVAL_WEEKS !== 0) return false;
  if (phase === 'RACE_SPECIFIC' || phase === 'TAPER') return false;
  // The proximity window protects the run-in to a race. A rolling block has
  // no race, and applying it there would suppress every deload in a 4-week
  // cycle — leaving an athlete who never unloads at all (D4, ERRATA F23).
  if (hasRaceDate && totalWeeks - weekIndex <= DELOAD_SUPPRESSION_WEEKS) return false;
  return true;
}

function rollingMax(history: readonly number[]): number {
  const window = history.slice(-ROLLING_MAX_WEEKS);
  return window.reduce((max, value) => Math.max(max, value), 0);
}

/**
 * Plans the running budget for every week.
 *
 * Growth is computed against the **3-week rolling maximum**, not against the
 * previous week. That is what lets an athlete return to full volume after a
 * deload: measuring from the deload week itself would trap them at the reduced
 * load, which is the deadlock the v0.1 "10% over previous week" rule created.
 */
export function planWeeklyVolume(input: VolumePlanInput): readonly WeeklyVolume[] {
  const { weeks, allocation, background, currentWeeklyRunM, baselineConfidence } = input;
  const hasRaceDate = input.hasRaceDate ?? true;

  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new RangeError(`weeks must be a positive integer, received ${weeks}.`);
  }
  if (!Number.isFinite(currentWeeklyRunM) || currentWeeklyRunM < 0) {
    throw new RangeError(
      `currentWeeklyRunM must be a non-negative number, received ${currentWeeklyRunM}.`,
    );
  }

  const ceilingFactor = ceilingFactorFor(background);
  const history: number[] = [];
  const plan: WeeklyVolume[] = [];

  for (let weekIndex = 1; weekIndex <= weeks; weekIndex += 1) {
    const phase = phaseForWeek(allocation, weekIndex);
    if (phase === null) throw new Error(`Week ${weekIndex} falls outside the phase allocation.`);

    const deload = isDeloadWeek(weekIndex, phase, weeks, hasRaceDate);

    let budgetM: number;
    let ceilingM: number;

    if (weekIndex === 1) {
      // Week 1 has no history to look back over, so it anchors to the
      // athlete's actual current volume (R3) rather than growing from zero.
      // D2 starts a self-reported baseline 15% lower.
      budgetM =
        currentWeeklyRunM * (baselineConfidence === 'LOW' ? LOW_CONFIDENCE_FACTOR : 1);
      ceilingM = budgetM;
    } else {
      const max = rollingMax(history);
      ceilingM = max * ceilingFactor;
      // Clamp growth to the ceiling. Without this a RUNNER's 1.08 Foundation
      // growth would breach their own tighter 1.05 cap — guardrail 1 is only
      // satisfied "by construction" if the construction actually respects it.
      const growth = deload
        ? DELOAD_VOLUME_FACTOR
        : Math.min(PHASE_GROWTH[phase], ceilingFactor - CEILING_SAFETY_MARGIN);
      budgetM = max * growth;
    }

    const rounded = Math.round(budgetM);
    history.push(rounded);
    plan.push(
      Object.freeze({
        weekIndex,
        phase,
        runningBudgetM: rounded,
        isDeload: deload,
        ceilingM: Math.round(ceilingM),
      }),
    );
  }

  return Object.freeze(plan);
}
