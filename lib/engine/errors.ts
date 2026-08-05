import type { Division } from '@/lib/seeds/types';

/**
 * Engine error types.
 *
 * Type-only imports from `lib/seeds` — the engine takes seed data as an
 * argument rather than importing the loader, so it keeps zero runtime
 * dependencies (PRD §9).
 */

/**
 * The divisions the engine will plan for in v1 (DECISIONS.md D1).
 *
 * Doubles is not a lighter Singles: work is split between two athletes by
 * mutual agreement, which makes pacing, station splitting and partner-relative
 * load balancing all engine inputs. That is a different problem, not a
 * parameter.
 */
export const SUPPORTED_DIVISIONS = ['OPEN_SINGLES', 'PRO_SINGLES'] as const;

export type SupportedDivision = (typeof SUPPORTED_DIVISIONS)[number];

/**
 * Thrown when a plan is requested for a division the engine does not support.
 *
 * Deliberately fatal. Silently falling back to a Singles plan would hand a
 * Doubles athlete a plan built on the wrong total workload — see D1.
 */
export class UnsupportedDivisionError extends Error {
  constructor(readonly division: Division) {
    super(
      `Division ${division} is not supported in v1. Supported divisions: ${SUPPORTED_DIVISIONS.join(', ')}.`,
    );
    this.name = 'UnsupportedDivisionError';
  }
}

/** True if the engine can generate a plan for this division. */
export function isSupportedDivision(division: Division): division is SupportedDivision {
  return (SUPPORTED_DIVISIONS as readonly Division[]).includes(division);
}

/**
 * Narrows a division to one the engine supports, or throws.
 *
 * Call this at every engine entry point, before any planning work.
 *
 * @throws UnsupportedDivisionError
 */
export function assertSupportedDivision(division: Division): asserts division is SupportedDivision {
  if (!isSupportedDivision(division)) throw new UnsupportedDivisionError(division);
}
