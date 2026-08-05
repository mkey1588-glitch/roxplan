import type { AthleticBackground, PhaseAllocation, PhaseSpan, PhaseType } from './types';
import { PHASE_TYPES } from './types';

/**
 * Phase allocation (PRD §7.1).
 *
 * Proportional split with largest-remainder rounding, so the parts sum
 * *exactly* to the plan length at every input. The v0.1 fixed lookup table
 * was arithmetically broken; this replaces it.
 *
 * Two deviations from the PRD's pseudo-code, both required for determinism
 * (ERRATA F11):
 *
 *  1. **Integer arithmetic.** `remaining * 0.35` produces values like
 *     `4.199999999999999`, and a floor over a float is a coin toss at the
 *     boundary. Percentages are integers and the division happens once, at
 *     the end.
 *  2. **An explicit tie-break.** Largest-remainder rounding is undefined when
 *     two phases have identical remainders, and that genuinely happens: 11,
 *     31 and 51 weeks each produce an exact tie between Build and
 *     Race-Specific. Ties resolve by {@link TIE_BREAK_ORDER}, favouring the
 *     phase closest to the race — the weeks nearest race day are the most
 *     specific to it, so they are the least wasteful place to put a spare
 *     week.
 */

/** Shortest plan the engine will build. At or below 4 weeks, §7.6 applies. */
export const MIN_PLAN_WEEKS = 5;

/** Longest plan the engine will build. */
export const MAX_PLAN_WEEKS = 52;

/** The taper is always exactly one week. */
export const TAPER_WEEKS = 1;

/** Integer percentages of the non-taper weeks. Must sum to 100. */
const PROPORTIONS: readonly (readonly [Exclude<PhaseType, 'TAPER'>, number])[] = [
  ['FOUNDATION', 40],
  ['BUILD', 35],
  ['RACE_SPECIFIC', 25],
];

/**
 * Tie-break priority for largest-remainder rounding: earlier wins.
 *
 * Race-Specific first, because a spare week is worth most closest to the race.
 */
export const TIE_BREAK_ORDER: readonly PhaseType[] = ['RACE_SPECIFIC', 'BUILD', 'FOUNDATION'];

/** Foundation may be borrowed from, but never to nothing. */
const MIN_FOUNDATION_WEEKS = 1;

/** Weeks a BEGINNER shifts into Foundation, budget permitting (§7.3). */
const BEGINNER_FOUNDATION_SHIFT = 2;

/**
 * Thrown when a plan is requested with too little runway.
 *
 * At or below 4 weeks there is not enough time to build race fitness safely,
 * and the caller must route to the readiness path (§7.6) — which guardrail 7
 * enforces. This error is the safety net for a caller that forgot.
 */
export class InsufficientRunwayError extends Error {
  constructor(readonly weeksToRace: number) {
    super(
      `${weeksToRace} weeks is not enough runway to build race fitness safely. ` +
        `Route to the readiness plan (PRD §7.6); standard plans start at ${MIN_PLAN_WEEKS} weeks.`,
    );
    this.name = 'InsufficientRunwayError';
  }
}

/** Thrown when the phase parts fail to sum to the plan length. */
export class PhaseAllocationInvariantError extends Error {
  constructor(
    readonly allocation: PhaseAllocation,
    readonly weeksToRace: number,
  ) {
    super(
      `Phase allocation ${JSON.stringify(allocation)} does not sum to ${weeksToRace} weeks. ` +
        `This is a P0 engine bug.`,
    );
    this.name = 'PhaseAllocationInvariantError';
  }
}

/** True if there is enough runway for a standard plan (§7.6, guardrail 7). */
export function hasSufficientRunway(weeksToRace: number): boolean {
  return Number.isInteger(weeksToRace) && weeksToRace >= MIN_PLAN_WEEKS;
}

/** Phase minimums, which relax below 8 weeks so short plans stay feasible. */
function minimumsFor(weeksToRace: number): { build: number; raceSpecific: number } {
  return weeksToRace >= 8 ? { build: 2, raceSpecific: 2 } : { build: 1, raceSpecific: 1 };
}

/**
 * Distributes `remaining` weeks across the three non-taper phases so the
 * parts sum exactly, using largest-remainder rounding with a fixed
 * tie-break.
 */
function largestRemainderRound(remaining: number): Record<Exclude<PhaseType, 'TAPER'>, number> {
  const parts = PROPORTIONS.map(([phase, percent]) => {
    const scaled = remaining * percent;
    return { phase, whole: Math.floor(scaled / 100), remainder: scaled % 100 };
  });

  const allocated = parts.reduce((sum, part) => sum + part.whole, 0);
  let leftover = remaining - allocated;

  // Sorting a copy; the entries are the same objects, so incrementing here
  // updates `parts`.
  const byPriority = [...parts].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      TIE_BREAK_ORDER.indexOf(a.phase) - TIE_BREAK_ORDER.indexOf(b.phase),
  );

  for (const part of byPriority) {
    if (leftover <= 0) break;
    part.whole += 1;
    leftover -= 1;
  }

  const result = { FOUNDATION: 0, BUILD: 0, RACE_SPECIFIC: 0 };
  for (const part of parts) result[part.phase] = part.whole;
  return result;
}

/**
 * Allocates whole weeks to the four phases.
 *
 * @param weeksToRace total plan length in whole weeks, 5-52
 * @throws InsufficientRunwayError below 5 weeks — route to §7.6 instead
 * @throws PhaseAllocationInvariantError if the parts fail to sum, which is a
 *   P0 bug rather than a recoverable condition
 */
export function allocatePhases(
  weeksToRace: number,
  background: AthleticBackground,
): PhaseAllocation {
  if (!Number.isInteger(weeksToRace)) {
    throw new RangeError(`weeksToRace must be a whole number, received ${weeksToRace}.`);
  }
  if (!hasSufficientRunway(weeksToRace)) throw new InsufficientRunwayError(weeksToRace);
  if (weeksToRace > MAX_PLAN_WEEKS) {
    throw new RangeError(
      `weeksToRace ${weeksToRace} exceeds the ${MAX_PLAN_WEEKS}-week maximum.`,
    );
  }

  const remaining = weeksToRace - TAPER_WEEKS;
  const rounded = largestRemainderRound(remaining);

  const alloc: Record<PhaseType, number> = {
    FOUNDATION: rounded.FOUNDATION,
    BUILD: rounded.BUILD,
    RACE_SPECIFIC: rounded.RACE_SPECIFIC,
    TAPER: TAPER_WEEKS,
  };

  // Minimums, borrowing from Foundation. Foundation is the right donor: it is
  // the least race-specific phase and the one with the most weeks to spare.
  const minimums = minimumsFor(weeksToRace);
  for (const [phase, minimum] of [
    ['BUILD', minimums.build],
    ['RACE_SPECIFIC', minimums.raceSpecific],
  ] as const) {
    const shortfall = minimum - alloc[phase];
    if (shortfall <= 0) continue;
    const borrowable = alloc.FOUNDATION - MIN_FOUNDATION_WEEKS;
    const borrowed = Math.min(shortfall, Math.max(borrowable, 0));
    alloc[phase] += borrowed;
    alloc.FOUNDATION -= borrowed;
  }

  // BEGINNER extends Foundation by up to 2 weeks, taking from Build first and
  // then Race-Specific, never below their minimums (§7.3). At 8 weeks both
  // are already at their floor, so this is a deliberate no-op there.
  if (background === 'BEGINNER') {
    let toShift = BEGINNER_FOUNDATION_SHIFT;
    for (const [phase, floorValue] of [
      ['BUILD', minimums.build],
      ['RACE_SPECIFIC', minimums.raceSpecific],
    ] as const) {
      if (toShift <= 0) break;
      const available = Math.max(alloc[phase] - floorValue, 0);
      const taken = Math.min(available, toShift);
      alloc[phase] -= taken;
      alloc.FOUNDATION += taken;
      toShift -= taken;
    }
  }

  const allocation: PhaseAllocation = Object.freeze({ ...alloc });

  // §7.1: "The assert is not decorative — it must be a runtime invariant."
  const sum = PHASE_TYPES.reduce((total, phase) => total + allocation[phase], 0);
  if (sum !== weeksToRace) throw new PhaseAllocationInvariantError(allocation, weeksToRace);

  return allocation;
}

/**
 * Expands an allocation into 1-based, inclusive week spans in phase order.
 *
 * Zero-week phases are omitted, though the minimums mean none should occur.
 */
export function phaseSpans(allocation: PhaseAllocation): readonly PhaseSpan[] {
  const spans: PhaseSpan[] = [];
  let cursor = 1;

  for (const type of PHASE_TYPES) {
    const weeks = allocation[type];
    if (weeks <= 0) continue;
    spans.push({ type, startWeek: cursor, endWeek: cursor + weeks - 1 });
    cursor += weeks;
  }

  return spans;
}

/** The phase covering a 1-based week index, or null if past the plan's end. */
export function phaseForWeek(allocation: PhaseAllocation, weekIndex: number): PhaseType | null {
  if (!Number.isInteger(weekIndex) || weekIndex < 1) {
    throw new RangeError(`Week index must be a positive integer, received ${weekIndex}.`);
  }
  for (const span of phaseSpans(allocation)) {
    if (weekIndex >= span.startWeek && weekIndex <= span.endWeek) return span.type;
  }
  return null;
}
