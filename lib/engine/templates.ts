import { DAYS_PER_WEEK } from './calendar';
import type { AthleticBackground, PhaseType } from './types';

/**
 * Weekly templates (PRD §7.4, as amended by ERRATA F08).
 *
 * A template answers two questions: how many sessions of each kind fall in a
 * week, and which day position each one occupies. Both are deterministic
 * functions of (sessionsPerWeek, phase, background) — no clock, no
 * randomness, no athlete history.
 *
 * Day positions are 0-6 *within the plan week*, not weekdays. Plan weeks are
 * anchored to race day and need not start on a Monday (ERRATA R1), so
 * `AthleteProfile.availableDays` is a soft preference applied when these
 * positions are mapped onto real dates, not a constraint on the template.
 */

/** Every session the engine can prescribe (PRD §7.4). */
export const SESSION_TYPES = [
  'EASY_RUN',
  'INTERVAL_RUN',
  'LONG_RUN',
  'STRENGTH_LOWER',
  'STRENGTH_UPPER',
  'STATION_SKILL',
  'COMPROMISED_RUN',
  'RACE_SIMULATION',
  'RECOVERY_MOBILITY',
  'REST',
] as const;

export type SessionType = (typeof SESSION_TYPES)[number];

/**
 * The coarse kind of work in a day's slot.
 *
 * Templates deal in slots rather than concrete session types because the
 * same slot resolves differently by phase — a HYBRID is station skill work in
 * Foundation, a compromised run in Build, and a race simulation in
 * Race-Specific. That resolution happens during session generation.
 */
export const SLOT_KINDS = ['RUN', 'STRENGTH', 'HYBRID', 'REST'] as const;

export type SlotKind = (typeof SLOT_KINDS)[number];

/** Round-robin order when two kinds have equal remaining counts. */
const KIND_PRIORITY: readonly Exclude<SlotKind, 'REST'>[] = ['RUN', 'STRENGTH', 'HYBRID'];

/** DECISIONS.md D6: two sessions a week is supported, with a note. */
export const MIN_SESSIONS_PER_WEEK = 2;
export const MAX_SESSIONS_PER_WEEK = 6;

/** Guardrail 4: at least one full rest day, always. */
export const MIN_REST_DAYS_PER_WEEK = 1;

/** PRD §7.3: `STRENGTH` backgrounds cap heavy lifting at 2 sessions a week. */
const STRENGTH_BACKGROUND_LIFT_CAP = 2;

export interface WeeklyComposition {
  readonly run: number;
  readonly strength: number;
  readonly hybrid: number;
  readonly rest: number;
}

export interface WeeklyTemplate {
  readonly sessionsPerWeek: number;
  readonly composition: WeeklyComposition;
  /** Exactly 7 entries, one per day position in the plan week. */
  readonly slots: readonly SlotKind[];
  /** i18n keys for advisory notes. The engine emits keys, never prose (D5). */
  readonly noteKeys: readonly string[];
}

export class InvalidSessionsPerWeekError extends RangeError {
  constructor(readonly sessionsPerWeek: number) {
    super(
      `sessionsPerWeek must be a whole number from ${MIN_SESSIONS_PER_WEEK} to ${MAX_SESSIONS_PER_WEEK}, received ${sessionsPerWeek}.`,
    );
    this.name = 'InvalidSessionsPerWeekError';
  }
}

/** Thrown when a template would breach the rest-day guardrail. */
export class RestDayInvariantError extends Error {
  constructor(readonly composition: WeeklyComposition) {
    super(
      `Weekly composition ${JSON.stringify(composition)} leaves fewer than ${MIN_REST_DAYS_PER_WEEK} rest days. This is a P0 engine bug (guardrail 4).`,
    );
    this.name = 'RestDayInvariantError';
  }
}

/**
 * Base composition by available days.
 *
 * **ERRATA F08.** The PRD's 6-day row read "3 run, 2 strength, 1 hybrid + 1
 * recovery" — seven sessions in a seven-day week, leaving no room for the
 * mandatory full rest day and so breaching guardrail 4 by construction. The
 * recovery session is dropped from the counted six; `RECOVERY_MOBILITY`
 * survives as a session type for auto-regulation to downgrade into, but is
 * never a scheduled training day.
 */
const BASE_COMPOSITIONS: Readonly<Record<number, Omit<WeeklyComposition, 'rest'>>> = {
  2: { run: 1, strength: 0, hybrid: 1 },
  3: { run: 1, strength: 1, hybrid: 1 },
  4: { run: 2, strength: 1, hybrid: 1 },
  5: { run: 2, strength: 2, hybrid: 1 },
  6: { run: 3, strength: 2, hybrid: 1 },
};

function assertValidSessionsPerWeek(sessionsPerWeek: number): void {
  if (
    !Number.isInteger(sessionsPerWeek) ||
    sessionsPerWeek < MIN_SESSIONS_PER_WEEK ||
    sessionsPerWeek > MAX_SESSIONS_PER_WEEK
  ) {
    throw new InvalidSessionsPerWeekError(sessionsPerWeek);
  }
}

/**
 * The weekly composition for an athlete, phase and background.
 *
 * Modifiers are applied in a fixed order so the result is deterministic:
 * phase adjustment first, then background.
 */
export function compositionFor(
  sessionsPerWeek: number,
  phase: PhaseType,
  background: AthleticBackground,
): WeeklyComposition {
  assertValidSessionsPerWeek(sessionsPerWeek);

  const base = BASE_COMPOSITIONS[sessionsPerWeek];
  if (base === undefined) throw new InvalidSessionsPerWeekError(sessionsPerWeek);

  let { run, strength, hybrid } = base;

  // §7.4, 5-day row: a hybrid replaces one strength day in Race-Specific.
  // Race rehearsal displaces general strength work as the race approaches.
  if (phase === 'RACE_SPECIFIC' && sessionsPerWeek === 5 && strength > 0) {
    strength -= 1;
    hybrid += 1;
  }

  // §7.3 RUNNER: an extra strength session in Foundation.
  //
  // **ERRATA F09.** The PRD phrased this as "+1 strength session/week", which
  // is additive and pushes the week past the athlete's stated availability —
  // a 6-day RUNNER would get 7 sessions and no rest day. It substitutes
  // instead: a run becomes a strength session. A runner's gap is
  // strength-endurance, not aerobic volume, so trading is the intent anyway.
  // No-op at 2 and 3 days a week, where only one run exists to trade.
  if (background === 'RUNNER' && phase === 'FOUNDATION' && run >= 2) {
    run -= 1;
    strength += 1;
  }

  // §7.3 STRENGTH: heavy lifting capped at 2 sessions a week from the start.
  // Already true of every base template; enforced so a future template change
  // cannot silently breach it.
  if (background === 'STRENGTH' && strength > STRENGTH_BACKGROUND_LIFT_CAP) {
    const excess = strength - STRENGTH_BACKGROUND_LIFT_CAP;
    strength -= excess;
    run += excess;
  }

  const rest = DAYS_PER_WEEK - (run + strength + hybrid);
  const composition: WeeklyComposition = Object.freeze({ run, strength, hybrid, rest });

  if (rest < MIN_REST_DAYS_PER_WEEK) throw new RestDayInvariantError(composition);

  return composition;
}

/**
 * Chooses which day positions carry a session, spreading them as evenly as
 * possible across the week.
 *
 * Even spacing is a recovery property, not an aesthetic one: bunching six
 * sessions into days 0-5 gives five consecutive training days, which is how
 * general-population athletes accumulate the overuse injuries §6 of the
 * research describes.
 */
function trainingDayPositions(trainingDays: number): readonly number[] {
  const positions: number[] = [];
  for (let i = 0; i < trainingDays; i += 1) {
    positions.push(
      Math.floor((i * DAYS_PER_WEEK) / trainingDays + DAYS_PER_WEEK / (2 * trainingDays)),
    );
  }
  return positions;
}

/**
 * Orders the week's sessions so the same kind rarely lands on consecutive
 * days, by round-robin over the kinds with the most sessions remaining.
 */
function orderedKinds(composition: WeeklyComposition): readonly Exclude<SlotKind, 'REST'>[] {
  const remaining: Record<Exclude<SlotKind, 'REST'>, number> = {
    RUN: composition.run,
    STRENGTH: composition.strength,
    HYBRID: composition.hybrid,
  };

  const sequence: Exclude<SlotKind, 'REST'>[] = [];
  let total = remaining.RUN + remaining.STRENGTH + remaining.HYBRID;

  while (total > 0) {
    const byCount = [...KIND_PRIORITY].sort(
      (a, b) => remaining[b] - remaining[a] || KIND_PRIORITY.indexOf(a) - KIND_PRIORITY.indexOf(b),
    );
    for (const kind of byCount) {
      if (remaining[kind] <= 0) continue;
      sequence.push(kind);
      remaining[kind] -= 1;
      total -= 1;
    }
  }

  return sequence;
}

/** Places a composition onto the seven day positions of a plan week. */
export function scheduleWeek(composition: WeeklyComposition): readonly SlotKind[] {
  const trainingDays = composition.run + composition.strength + composition.hybrid;
  const positions = trainingDayPositions(trainingDays);
  const kinds = orderedKinds(composition);

  const slots: SlotKind[] = Array.from({ length: DAYS_PER_WEEK }, () => 'REST');
  positions.forEach((position, index) => {
    const kind = kinds[index];
    if (kind === undefined) throw new Error('template scheduling ran out of sessions');
    slots[position] = kind;
  });

  // The template repeats identically, so the last day of one week sits next to
  // the first day of the next (ERRATA F31). A hybrid is always the week's
  // hardest session and the following week opens with quality work, so ending
  // on one puts two hard days back to back — which §7.4 forbids outright for
  // BEGINNER. Move it one training slot earlier.
  const lastDay = DAYS_PER_WEEK - 1;
  if (slots[0] !== 'REST' && slots[lastDay] === 'HYBRID') {
    for (let day = lastDay - 1; day >= 0; day -= 1) {
      const candidate = slots[day];
      if (candidate === undefined || candidate === 'REST' || candidate === 'HYBRID') continue;
      slots[day] = 'HYBRID';
      slots[lastDay] = candidate;
      break;
    }
  }

  return Object.freeze(slots);
}

/**
 * The full weekly template: composition, day placement, and any advisory
 * notes as i18n keys.
 */
export function templateFor(
  sessionsPerWeek: number,
  phase: PhaseType,
  background: AthleticBackground,
): WeeklyTemplate {
  const composition = compositionFor(sessionsPerWeek, phase, background);
  const slots = scheduleWeek(composition);

  const noteKeys: string[] = [];
  // D6: serve the athlete who honestly has two days, and say once that three
  // is better. Do not block, do not nag.
  if (sessionsPerWeek === 2) noteKeys.push('plan.note.twoDayWeek');

  const scheduled = slots.filter((slot) => slot !== 'REST').length;
  if (scheduled !== sessionsPerWeek) {
    throw new Error(
      `Template for ${sessionsPerWeek} sessions scheduled ${scheduled}. This is a P0 engine bug.`,
    );
  }

  return Object.freeze({
    sessionsPerWeek,
    composition,
    slots,
    noteKeys: Object.freeze(noteKeys),
  });
}
