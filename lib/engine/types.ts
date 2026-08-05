/**
 * Core engine vocabulary.
 *
 * The engine is a pure function of its inputs (CLAUDE.md rule 1), so
 * everything it needs arrives as an argument — including the reference date
 * and the seed data. Nothing here reads a clock, a network, or a database.
 */

/**
 * The athlete's starting point, and the primary branch point in planning
 * (PRD §7.3). Two athletes with identical race goals need opposite
 * programming depending on where they are coming from: a runner already has
 * the aerobic base and lacks strength-endurance; a lifter has the opposite
 * problem and needs Zone 2 volume front-loaded.
 */
export const ATHLETIC_BACKGROUNDS = ['RUNNER', 'STRENGTH', 'HYBRID', 'BEGINNER'] as const;

export type AthleticBackground = (typeof ATHLETIC_BACKGROUNDS)[number];

/**
 * The four training phases, in the order they occur.
 *
 * Foundation builds the aerobic base and movement quality; Build adds load,
 * threshold running and compromised running; Race-Specific rehearses the race
 * itself; Taper sheds volume while keeping intensity.
 */
export const PHASE_TYPES = ['FOUNDATION', 'BUILD', 'RACE_SPECIFIC', 'TAPER'] as const;

export type PhaseType = (typeof PHASE_TYPES)[number];

/** Whole weeks assigned to each phase. Always sums to the plan length. */
export type PhaseAllocation = Readonly<Record<PhaseType, number>>;

/**
 * A phase's span in 1-based, inclusive week indices.
 *
 * Week indices rather than dates, so a plan stays portable across timezone
 * and race-date changes (ERRATA F21, DECISIONS.md D7).
 */
export interface PhaseSpan {
  readonly type: PhaseType;
  readonly startWeek: number;
  readonly endWeek: number;
}
